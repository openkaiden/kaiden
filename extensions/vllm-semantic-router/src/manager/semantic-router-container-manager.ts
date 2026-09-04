/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  Disposable,
  ExtensionContext,
  Provider,
  SemanticRouter,
  SemanticRouterCreateParams,
} from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import type Dockerode from 'dockerode';
import { inject, injectable } from 'inversify';
import { parse, stringify } from 'yaml';

import { EnvoyCluster, type EnvoyConfig, EnvoyRoute } from '/@/api/envoy-config-schema';
import { LABEL_ID, LABEL_NAME, LABEL_ROLE } from '/@/api/semantic-router-container-info';
import { SRBackendRef, type SRConfig, SRConfigSchema, SRModel } from '/@/api/sr-config-schema';
import { ContainerFinder } from '/@/helper/container-finder';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, VllmSemanticRouterProvider } from '/@/inject/symbol';

const VLLM_SR_IMAGE = 'ghcr.io/vllm-project/semantic-router/vllm-sr:v0.3.0';
const ENVOY_IMAGE = 'envoyproxy/envoy:v1.34-latest';
const ROUTER_GRPC_PORT = 50051;
const ENVOY_LISTEN_PORT = 8801;

interface ManagedConnection {
  routerContainerId: string;
  envoyContainerId: string;
  dockerode: Dockerode;
  disposable: Disposable;
  port: number;
  running: boolean;
}

type ModelInfo = { cluster: EnvoyCluster; route: EnvoyRoute };

@injectable()
export class SemanticRouterContainerManager {
  @inject(VllmSemanticRouterProvider)
  private provider: Provider;

  @inject(ContainerExtensionAPISymbol)
  private containerExtensionAPI: ContainerExtensionAPI;

  @inject(ExtensionContextSymbol)
  private extensionContext: ExtensionContext;

  @inject(ContainerFinder)
  private containerFinder: ContainerFinder;

  #connections: Map<string, ManagedConnection> = new Map();
  #factoryDisposable: Disposable | undefined;

  async init(): Promise<void> {
    this.#factoryDisposable = this.provider.setSemanticRouterConnectionFactory({
      type: 'vllm',
      create: async (params: SemanticRouterCreateParams): Promise<SemanticRouter> => {
        return this.create(params);
      },
    });
  }

  async create(params: SemanticRouterCreateParams): Promise<SemanticRouter> {
    console.log(`Creating semantic router`, params);
    const endpoints = this.containerExtensionAPI.getEndpoints();
    if (endpoints.length === 0) {
      throw new Error('No container engine available');
    }
    const dockerode = endpoints[0]!.dockerode;

    const existing = await this.findExistingContainers(dockerode, params.name);
    if (existing) {
      await this.registerInferenceConnection(
        params.name,
        existing.connectionId,
        existing.envoyHostPort,
        dockerode,
        existing.routerContainerId,
        existing.envoyContainerId,
        existing.running,
      );
      return { connectionId: existing.connectionId };
    }

    const connectionId = randomUUID();

    const routerDir = join(this.extensionContext.storagePath, 'configs', params.name);
    if (!existsSync(routerDir)) {
      await mkdir(routerDir, { recursive: true });
    }

    const configFilePath = join(routerDir, 'config.yaml');
    await writeFile(configFilePath, params.config, 'utf-8');

    await this.pullImage(dockerode, VLLM_SR_IMAGE);

    const routerGrpcHostPort = randomInt(1024, 65536);

    const routerContainer = await dockerode.createContainer({
      Image: VLLM_SR_IMAGE,
      Labels: {
        [LABEL_NAME]: params.name,
        [LABEL_ID]: connectionId,
        [LABEL_ROLE]: 'router',
      },
      ExposedPorts: {
        [`${ROUTER_GRPC_PORT}/tcp`]: {},
      },
      Env: [
        'SR_LOG_LEVEL=debug',
        'SR_LOG_ENCODING=console',
        'OTEL_TRACES_EXPORTER=console',
        'OTEL_SERVICE_NAME=semantic-router',
      ],
      HostConfig: {
        PortBindings: {
          [`${ROUTER_GRPC_PORT}/tcp`]: [{ HostPort: String(routerGrpcHostPort) }],
        },
        SecurityOpt: ['label=disable'],
        Mounts: [
          {
            Source: configFilePath,
            Type: 'bind' as const,
            Target: '/app/config.yaml',
            ReadOnly: true,
          },
        ],
      },
    });

    const envoyConfigContent = this.generateEnvoyConfig(routerGrpcHostPort, params.config);
    const envoyConfigFilePath = join(routerDir, 'envoy.yaml');
    await writeFile(envoyConfigFilePath, envoyConfigContent, 'utf-8');

    await this.pullImage(dockerode, ENVOY_IMAGE);

    const envoyHostPort = randomInt(1024, 65536);

    const envoyContainer = await dockerode.createContainer({
      Image: ENVOY_IMAGE,
      User: '101',
      Cmd: ['envoy', '-c', '/etc/envoy/envoy.yaml', '-l', 'debug'],
      Labels: {
        [LABEL_NAME]: params.name,
        [LABEL_ID]: connectionId,
        [LABEL_ROLE]: 'envoy',
      },
      ExposedPorts: {
        [`${ENVOY_LISTEN_PORT}/tcp`]: {},
      },
      HostConfig: {
        PortBindings: {
          [`${ENVOY_LISTEN_PORT}/tcp`]: [{ HostPort: String(envoyHostPort) }],
        },
        ExtraHosts: ['host.docker.internal:host-gateway'],
        SecurityOpt: ['label=disable'],
        Mounts: [
          {
            Source: envoyConfigFilePath,
            Type: 'bind' as const,
            Target: '/etc/envoy/envoy.yaml',
            ReadOnly: true,
          },
        ],
      },
    });

    await this.registerInferenceConnection(
      params.name,
      connectionId,
      envoyHostPort,
      dockerode,
      routerContainer.id,
      envoyContainer.id,
      false,
    );

    return { connectionId };
  }

  private async findExistingContainers(
    dockerode: Dockerode,
    name: string,
  ): Promise<
    | {
        connectionId: string;
        routerContainerId: string;
        envoyContainerId: string;
        envoyHostPort: number;
        running: boolean;
      }
    | undefined
  > {
    let containers: Dockerode.ContainerInfo[];
    try {
      containers = await dockerode.listContainers({ all: true });
    } catch {
      return undefined;
    }

    const srContainers = this.containerFinder.findSemanticRouterContainers(containers);
    const router = this.containerFinder.findByNameAndRole(srContainers, name, 'router');
    const envoy = this.containerFinder.findByNameAndRole(srContainers, name, 'envoy');

    if (!router || !envoy) {
      return undefined;
    }

    const envoyHostPort = this.extractHostPort(envoy);
    if (!envoyHostPort) {
      return undefined;
    }

    return {
      connectionId: router.Labels[LABEL_ID],
      routerContainerId: router.Id,
      envoyContainerId: envoy.Id,
      envoyHostPort,
      running: router.State === 'running' && envoy.State === 'running',
    };
  }

  private extractHostPort(container: Dockerode.ContainerInfo): number | undefined {
    const ports = container.Ports;
    if (!ports || ports.length === 0) {
      return undefined;
    }
    const mapped = ports.find(p => p.PublicPort !== undefined);
    return mapped?.PublicPort;
  }

  private async registerInferenceConnection(
    name: string,
    connectionId: string,
    envoyHostPort: number,
    dockerode: Dockerode,
    routerContainerId: string,
    envoyContainerId: string,
    running: boolean,
  ): Promise<void> {
    const managed: ManagedConnection = {
      routerContainerId,
      envoyContainerId,
      dockerode,
      disposable: undefined!,
      port: envoyHostPort,
      running,
    };

    const sdk = createOpenAICompatible({
      baseURL: `http://localhost:${envoyHostPort}/v1`,
      name: `vllm-sr/${name}`,
    });

    managed.disposable = this.provider.registerInferenceProviderConnection({
      id: connectionId,
      name: name,
      type: 'local',
      llmMetadata: { name: 'openai', semanticRouter: name },
      endpoint: `http://localhost:${envoyHostPort}/v1`,
      sdk,
      status() {
        return managed.running ? 'started' : 'stopped';
      },
      models: [
        {
          label: `Semantic Router ${name}`,
        },
      ],
      credentials() {
        return {};
      },
      lifecycle: {
        start: async (): Promise<void> => {
          await dockerode.getContainer(routerContainerId).start();
          await dockerode.getContainer(envoyContainerId).start();
          managed.running = true;
        },
        stop: async (): Promise<void> => {
          await dockerode.getContainer(envoyContainerId).stop();
          await dockerode.getContainer(routerContainerId).stop();
          managed.running = false;
        },
        delete: async (): Promise<void> => {
          await this.deleteConnection(connectionId, dockerode, routerContainerId, envoyContainerId, name);
        },
      },
    });

    this.#connections.set(connectionId, managed);
  }

  private async deleteConnection(
    connectionId: string,
    dockerode: Dockerode,
    routerContainerId: string,
    envoyContainerId: string,
    name: string,
  ): Promise<void> {
    for (const containerId of [envoyContainerId, routerContainerId]) {
      try {
        const container = dockerode.getContainer(containerId);
        try {
          await container.stop();
        } catch {
          // container may already be stopped
        }
        await container.remove();
      } catch (err: unknown) {
        console.error(`vllm-semantic-router: failed to remove container ${containerId}`, err);
      }
    }

    const routerDir = join(this.extensionContext.storagePath, 'configs', name);
    await rm(routerDir, { recursive: true, force: true });

    const managed = this.#connections.get(connectionId);
    managed?.disposable.dispose();
    this.#connections.delete(connectionId);
  }

  private generateEnvoyConfig(routerGrpcHostPort: number, srConfig: string): string {
    try {
      const srParsed = SRConfigSchema.parse(parse(srConfig));
      const models = this.extractModels(srParsed);

      const config: EnvoyConfig = {
        static_resources: {
          listeners: [
            {
              name: 'listener_0',
              address: {
                socket_address: { address: '0.0.0.0', port_value: ENVOY_LISTEN_PORT },
              },
              filter_chains: [
                {
                  filters: [
                    {
                      name: 'envoy.filters.network.http_connection_manager',
                      typed_config: {
                        '@type':
                          'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
                        stat_prefix: 'ingress_http',
                        route_config: {
                          name: 'local_route',
                          virtual_hosts: [
                            {
                              name: 'local_service',
                              domains: ['*'],
                              request_headers_to_remove: [
                                'x-vsr-looper-request',
                                'x-vsr-looper-secret',
                                'x-vsr-looper-decision',
                                'x-vsr-looper-iteration',
                                'x-authz-user-id',
                                'x-authz-user-groups',
                              ],
                              routes: [
                                ...models.map(m => m.route),
                                { match: { prefix: '/' }, direct_response: { status: 503 } },
                              ],
                            },
                          ],
                        },
                        http_filters: [
                          {
                            name: 'envoy.filters.http.ext_proc',
                            typed_config: {
                              '@type':
                                'type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor',
                              grpc_service: {
                                envoy_grpc: { cluster_name: 'extproc_service' },
                              },
                              processing_mode: {
                                request_header_mode: 'SEND',
                                response_header_mode: 'SEND',
                                request_body_mode: 'BUFFERED',
                                response_body_mode: 'BUFFERED',
                              },
                              failure_mode_allow: false,
                              message_timeout: '300s',
                            },
                          },
                          {
                            name: 'envoy.filters.http.router',
                            typed_config: {
                              '@type': 'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router',
                            },
                          },
                        ],
                        stream_idle_timeout: '300s',
                        request_timeout: '300s',
                      },
                    },
                  ],
                },
              ],
            },
          ],
          clusters: [
            {
              name: 'extproc_service',
              connect_timeout: '5s',
              type: 'LOGICAL_DNS',
              lb_policy: 'ROUND_ROBIN',
              http2_protocol_options: {},
              load_assignment: {
                cluster_name: 'extproc_service',
                endpoints: [
                  {
                    lb_endpoints: [
                      {
                        endpoint: {
                          address: {
                            socket_address: {
                              address: 'host.docker.internal',
                              port_value: routerGrpcHostPort,
                            },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            },
            ...models.map(m => m.cluster),
          ],
        },
        admin: {
          address: {
            socket_address: { address: '0.0.0.0', port_value: 9901 },
          },
        },
      };

      return stringify(config);
    } catch (e: unknown) {
      console.error('Error generating Envoy configuration file', e);
      throw e;
    }
  }

  private extractModels(srConfig: SRConfig): ModelInfo[] {
    const seen = new Set<string>();
    const clusters: ModelInfo[] = [];

    for (const model of srConfig.providers.models) {
      if (seen.has(model.name)) {
        continue;
      }
      for (const ref of model.backend_refs) {
        this.addModelInfoIfRequired(seen, ref, model, clusters);
      }
    }

    return clusters;
  }

  private addModelInfoIfRequired(seen: Set<string>, ref: SRBackendRef, model: SRModel, modelInfos: ModelInfo[]): void {
    if (seen.has(model.name)) {
      return;
    }
    seen.add(model.name);

    const colonIndex = ref.endpoint.lastIndexOf(':');
    const host = colonIndex === -1 ? ref.endpoint : ref.endpoint.slice(0, colonIndex);
    const port = colonIndex === -1 ? (ref.protocol === 'http' ? 80 : 443) : Number(ref.endpoint.slice(colonIndex + 1));
    if (isNaN(port)) {
      return;
    }
    const clusterName = `${model.name}`;

    const modelInfo: ModelInfo = {
      cluster: {
        name: clusterName,
        connect_timeout: '5s',
        type: 'LOGICAL_DNS',
        dns_lookup_family: 'V4_ONLY',
        lb_policy: 'ROUND_ROBIN',
        load_assignment: {
          cluster_name: clusterName,
          endpoints: [
            {
              lb_endpoints: [
                {
                  endpoint: {
                    address: {
                      socket_address: { address: host.split('/')[0], port_value: port },
                    },
                    hostname: host.split('/')[0],
                  },
                },
              ],
            },
          ],
        },
        transport_socket: {
          name: 'envoy.transport_sockets.tls',
          typed_config: {
            '@type': 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext',
            sni: host.split('/')[0],
            common_tls_context: {
              tls_params: {
                tls_minimum_protocol_version: 'TLSv1_2',
                tls_maximum_protocol_version: 'TLSv1_3',
              },
            },
          },
        },
      },
      route: {
        match: {
          prefix: '/',
          headers: [
            {
              name: 'x-selected-model',
              string_match: {
                exact: clusterName,
              },
            },
          ],
        },
        route: {
          cluster: clusterName,
          host_rewrite_literal: host.split('/')[0],
        },
      },
    };
    if (model.name.startsWith('gemini')) {
      modelInfo.route.route!.regex_rewrite = {
        pattern: {
          google_re2: {},
          regex: '^/v1(.*)$',
        },
        substitution: '/v1beta/openai\\1',
      };
    }

    modelInfos.push(modelInfo);
  }

  private async pullImage(dockerode: Dockerode, image: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    try {
      const stream = await dockerode.pull(image);
      dockerode.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        () => {},
      );
    } catch (err: unknown) {
      reject(err);
    }
    return promise;
  }

  dispose(): void {
    this.#factoryDisposable?.dispose();
    for (const managed of this.#connections.values()) {
      managed.disposable.dispose();
    }
    this.#connections.clear();
  }
}
