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

import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { isIPv6 } from 'node:net';
import { join } from 'node:path';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  Disposable,
  ExtensionContext,
  Logger,
  Provider,
  SemanticRouter,
  SemanticRouterCreateParams,
} from '@openkaiden/api';
import { net } from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
import type Dockerode from 'dockerode';
import { inject, injectable } from 'inversify';

import { RouterReadySchema } from '/@/api/router-ready-schema';
import {
  SemanticRouterImage,
  SemanticRouterLabel,
  SemanticRouterPort,
  SemanticRouterRole,
} from '/@/api/semantic-router-container-info';
import type { SRConfig } from '/@/api/sr-config-schema';
import { ContainerFinder } from '/@/helper/container-finder';
import { EnvoyConfigGenerator } from '/@/helper/envoy-config-generator';
import { ImageHelper } from '/@/helper/image-helper';
import { NetworkHelper } from '/@/helper/network-helper';
import { SemanticRouterConfigParser } from '/@/helper/semantic-router-config-parser';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, VllmSemanticRouterProvider } from '/@/inject/symbol';

interface ManagedConnection {
  routerContainerId: string;
  envoyContainerId: string;
  dockerode: Dockerode;
  // socket path of the engine the containers run on
  endpointPath: string;
  disposable: Disposable;
  port: number;
  // host port of the router apiserver, polled on /ready when starting
  apiPort: number;
  running: boolean;
  // set while waiting for the router to be ready after starting the containers
  starting: boolean;
}

@injectable()
export class SemanticRouterContainerManager {
  private static readonly READY_TIMEOUT_MS = 120_000;
  private static readonly READY_POLL_INTERVAL_MS = 10_000;
  private static readonly CONFIGS_FOLDER = 'configs';
  private static readonly ROUTER_CONFIG_FILE = 'config.yaml';
  private static readonly ENVOY_CONFIG_FILE = 'envoy.yaml';
  private static readonly ROUTER_CONFIG_CONTAINER_PATH = '/app/config.yaml';
  private static readonly ENVOY_CONFIG_CONTAINER_PATH = '/etc/envoy/envoy.yaml';

  @inject(VllmSemanticRouterProvider)
  private provider: Provider;

  @inject(ContainerExtensionAPISymbol)
  private containerExtensionAPI: ContainerExtensionAPI;

  @inject(ExtensionContextSymbol)
  private extensionContext: ExtensionContext;

  @inject(ContainerFinder)
  private containerFinder: ContainerFinder;

  @inject(NetworkHelper)
  private networkHelper: NetworkHelper;

  @inject(SemanticRouterConfigParser)
  private configParser: SemanticRouterConfigParser;

  @inject(EnvoyConfigGenerator)
  private envoyConfigGenerator: EnvoyConfigGenerator;

  @inject(ImageHelper)
  private imageHelper: ImageHelper;

  #connections: Map<string, ManagedConnection> = new Map();
  #factoryDisposable: Disposable | undefined;
  #endpointsSubscription: Disposable | undefined;
  #containersSubscription: Disposable | undefined;

  async init(): Promise<void> {
    // containers can be stopped, started or removed outside of this extension (or crash)
    this.#containersSubscription = this.containerExtensionAPI.onContainersChanged(() =>
      this.refreshConnections().catch((err: unknown) =>
        console.error('vllm-semantic-router: failed to refresh semantic router connections', err),
      ),
    );
    this.#endpointsSubscription = this.containerExtensionAPI.onEndpointsChanged(endpoints =>
      this.updateFactoryRegistration(endpoints).catch((err: unknown) =>
        console.error('vllm-semantic-router: failed to update semantic router factory registration', err),
      ),
    );
    await this.updateFactoryRegistration(this.containerExtensionAPI.getEndpoints());
  }

  private async updateFactoryRegistration(endpoints: readonly EndpointConnection[]): Promise<void> {
    this.unregisterConnectionsOfRemovedEndpoints(endpoints);
    if (endpoints.length > 0) {
      if (!this.#factoryDisposable) {
        this.#factoryDisposable = this.provider.setSemanticRouterConnectionFactory({
          type: 'vllm',
          create: async (params: SemanticRouterCreateParams, logger?: Logger): Promise<SemanticRouter> => {
            return this.create(params, logger);
          },
        });
      }
      // engines may have been added: discovery skips the routers already registered
      await this.discoverExistingConnections(endpoints);
    } else if (this.#factoryDisposable) {
      this.#factoryDisposable.dispose();
      this.#factoryDisposable = undefined;
    }
  }

  // update the running state of the known connections and drop the ones whose containers are gone
  private async refreshConnections(): Promise<void> {
    // only connections known before listing: a router registered meanwhile must not be dropped
    const byEndpoint = new Map<string, [string, ManagedConnection][]>();
    for (const entry of this.#connections) {
      const entries = byEndpoint.get(entry[1].endpointPath) ?? [];
      entries.push(entry);
      byEndpoint.set(entry[1].endpointPath, entries);
    }

    for (const [endpointPath, entries] of byEndpoint) {
      let containers: Dockerode.ContainerInfo[];
      try {
        containers = await entries[0][1].dockerode.listContainers({ all: true });
      } catch (err: unknown) {
        console.error(`vllm-semantic-router: failed to list containers of ${endpointPath}`, err);
        continue;
      }
      for (const [connectionId, managed] of entries) {
        const router = containers.find(c => c.Id === managed.routerContainerId);
        const envoy = containers.find(c => c.Id === managed.envoyContainerId);
        if (!router || !envoy) {
          if (this.#connections.get(connectionId) === managed) {
            console.warn(`vllm-semantic-router: containers of semantic router '${connectionId}' are gone`);
            managed.disposable.dispose();
            this.#connections.delete(connectionId);
          }
          continue;
        }
        // while starting, status() reports starting until the router is ready
        managed.running = router.State === 'running' && envoy.State === 'running';
      }
    }
  }

  private unregisterConnectionsOfRemovedEndpoints(endpoints: readonly EndpointConnection[]): void {
    const paths = new Set(endpoints.map(endpoint => endpoint.path));
    for (const [connectionId, managed] of this.#connections) {
      if (!paths.has(managed.endpointPath)) {
        managed.disposable.dispose();
        this.#connections.delete(connectionId);
      }
    }
  }

  private async discoverExistingConnections(endpoints: readonly EndpointConnection[]): Promise<void> {
    for (const { path: endpointPath, dockerode } of endpoints) {
      let containers: Dockerode.ContainerInfo[];
      try {
        containers = await dockerode.listContainers({ all: true });
      } catch (err: unknown) {
        console.error('vllm-semantic-router: failed to list containers', err);
        continue;
      }

      const srContainers = this.containerFinder.findSemanticRouterContainers(containers);
      for (const router of srContainers.filter(c => c.Labels[SemanticRouterLabel.ROLE] === SemanticRouterRole.ROUTER)) {
        // labels come from any container on the engine: validate before using the name as a path
        const name = router.Labels[SemanticRouterLabel.NAME];
        try {
          this.configParser.validateName(name);
        } catch (err: unknown) {
          console.warn(`vllm-semantic-router: skipping container ${router.Id} with invalid name`, err);
          continue;
        }
        if (this.#connections.has(name)) {
          continue;
        }
        if (!(await this.isConfigFolderPresent(name))) {
          console.warn(`vllm-semantic-router: no config folder found for semantic router '${name}', skipping`);
          continue;
        }
        const envoy = this.containerFinder.findByNameAndRole(srContainers, name, SemanticRouterRole.ENVOY);
        if (!envoy) {
          console.warn(`vllm-semantic-router: no envoy container found for semantic router '${name}'`);
          continue;
        }
        try {
          // port bindings are only listed for running containers, so inspect to also support stopped ones
          const routerInfo = await dockerode.getContainer(router.Id).inspect();
          const envoyHostPort = this.getHostPort(routerInfo, SemanticRouterPort.ENVOY_LISTEN);
          const envoyHostAddress =
            routerInfo.HostConfig.PortBindings?.[`${SemanticRouterPort.ENVOY_LISTEN}/tcp`]?.[0]?.HostIp ?? '';
          const apiHostPort = this.getHostPort(routerInfo, SemanticRouterPort.ROUTER_API);
          if (envoyHostPort === undefined || apiHostPort === undefined) {
            console.warn(
              `vllm-semantic-router: envoy or router api port not bound on the router container of semantic router '${name}', recreate it`,
            );
            continue;
          }
          await this.registerInferenceConnection(
            name,
            name,
            this.getEndpointHost(envoyHostAddress),
            envoyHostPort,
            apiHostPort,
            dockerode,
            endpointPath,
            router.Id,
            envoy.Id,
            router.State === 'running' && envoy.State === 'running',
          );
        } catch (err: unknown) {
          console.error(`vllm-semantic-router: failed to register existing semantic router '${name}'`, err);
        }
      }
    }
  }

  // debug logs may contain prompt content: only enable them in development builds
  private getLogLevel(): 'debug' | 'info' {
    return import.meta.env.DEV ? 'debug' : 'info';
  }

  private getConfigsDir(): string {
    return join(this.extensionContext.storagePath, SemanticRouterContainerManager.CONFIGS_FOLDER);
  }

  private getRouterDir(name: string): string {
    return join(this.getConfigsDir(), name);
  }

  private async isConfigFolderPresent(name: string): Promise<boolean> {
    const routerDir = this.getRouterDir(name);
    try {
      return (await stat(routerDir)).isDirectory();
    } catch (err: unknown) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
        console.error(`vllm-semantic-router: failed to check config folder ${routerDir}`, err);
      }
      return false;
    }
  }

  // the port requested by the listener must be free; 0 or less picks a free port
  private async resolveEnvoyHostPort(requestedPort: number): Promise<number> {
    if (requestedPort <= 0) {
      return net.getFreePort(0);
    }
    if ((await net.getFreePort(requestedPort)) !== requestedPort) {
      throw new Error(`Port ${requestedPort} is already in use`);
    }
    return requestedPort;
  }

  // host to reach a port published on `address` from this machine
  private getEndpointHost(address: string): string {
    if (address === '' || address === '0.0.0.0' || address === '::' || address === '127.0.0.1') {
      return 'localhost';
    }
    return isIPv6(address) ? `[${address}]` : address;
  }

  // envoy shares the router network namespace, so all ports are published on the router container
  private getHostPort(routerInfo: Dockerode.ContainerInspectInfo, containerPort: number): number | undefined {
    const hostPort = Number(routerInfo.HostConfig.PortBindings?.[`${containerPort}/tcp`]?.[0]?.HostPort);
    return Number.isInteger(hostPort) && hostPort > 0 ? hostPort : undefined;
  }

  async create(params: SemanticRouterCreateParams, logger?: Logger): Promise<SemanticRouter> {
    this.configParser.validateName(params.name);
    const srConfig = this.configParser.parseConfig(params.config);

    const endpoints = this.containerExtensionAPI.getEndpoints();
    if (endpoints.length === 0) {
      throw new Error('No container engine available');
    }
    const { path: endpointPath, dockerode } = endpoints[0];
    // parseConfig already ensured exactly one listener
    const [listener] = srConfig.listeners;
    const envoyHostPort = await this.resolveEnvoyHostPort(listener.port);

    await mkdir(this.getConfigsDir(), { recursive: true });
    const routerDir = this.getRouterDir(params.name);
    try {
      await mkdir(routerDir);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
        throw new Error(`A semantic router named '${params.name}' already exists`);
      }
      throw err;
    }

    const createdContainers: Dockerode.Container[] = [];
    try {
      return await this.createContainers(
        params,
        srConfig,
        listener.address,
        envoyHostPort,
        dockerode,
        endpointPath,
        routerDir,
        createdContainers,
        logger,
      );
    } catch (err: unknown) {
      console.error(`vllm-semantic-router: failed to create semantic router '${params.name}'`, err);
      logger?.error(`Failed to create semantic router '${params.name}':`, err);
      // envoy uses the router network namespace: remove it first
      for (const container of createdContainers.toReversed()) {
        try {
          await container.remove({ force: true });
        } catch (removeErr: unknown) {
          console.error(`vllm-semantic-router: failed to remove container ${container.id}`, removeErr);
        }
      }
      await rm(routerDir, { recursive: true, force: true });
      throw err;
    }
  }

  private async createContainers(
    params: SemanticRouterCreateParams,
    srConfig: SRConfig,
    envoyHostAddress: string,
    envoyHostPort: number,
    dockerode: Dockerode,
    endpointPath: string,
    routerDir: string,
    createdContainers: Dockerode.Container[],
    logger?: Logger,
  ): Promise<SemanticRouter> {
    const connectionId = params.name;

    const configFilePath = join(routerDir, SemanticRouterContainerManager.ROUTER_CONFIG_FILE);
    await writeFile(configFilePath, params.config, 'utf-8');

    await this.imageHelper.ensureImage(dockerode, SemanticRouterImage.ROUTER, logger);

    // ports are only reserved when the container starts: search after the envoy port so both differ
    const apiHostPort = await net.getFreePort(envoyHostPort + 1);

    const routerContainer = await dockerode.createContainer({
      Image: SemanticRouterImage.ROUTER,
      Labels: {
        [SemanticRouterLabel.NAME]: params.name,
        [SemanticRouterLabel.ROLE]: SemanticRouterRole.ROUTER,
      },
      // envoy joins this container network namespace: the router gRPC port stays private, the envoy port
      // and the router apiserver port (polled on /ready) are published here
      ExposedPorts: {
        [`${SemanticRouterPort.ENVOY_LISTEN}/tcp`]: {},
        [`${SemanticRouterPort.ROUTER_API}/tcp`]: {},
      },
      Env: [
        `SR_LOG_LEVEL=${this.getLogLevel()}`,
        'SR_LOG_ENCODING=console',
        `OTEL_TRACES_EXPORTER=${import.meta.env.DEV ? 'console' : 'none'}`,
        'OTEL_SERVICE_NAME=semantic-router',
      ],
      HostConfig: {
        PortBindings: {
          [`${SemanticRouterPort.ENVOY_LISTEN}/tcp`]: [{ HostIp: envoyHostAddress, HostPort: String(envoyHostPort) }],
          // the router api is only used for the readiness check: it stays on loopback
          [`${SemanticRouterPort.ROUTER_API}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(apiHostPort) }],
        },
        // read-only, relabelled with :Z so that SELinux enforcing hosts let the container read it (no effect elsewhere)
        Binds: [`${configFilePath}:${SemanticRouterContainerManager.ROUTER_CONFIG_CONTAINER_PATH}:ro,Z`],
      },
    });
    createdContainers.push(routerContainer);

    const envoyConfigContent = this.envoyConfigGenerator.generate(srConfig);
    const envoyConfigFilePath = join(routerDir, SemanticRouterContainerManager.ENVOY_CONFIG_FILE);
    await writeFile(envoyConfigFilePath, envoyConfigContent, 'utf-8');

    await this.imageHelper.ensureImage(dockerode, SemanticRouterImage.ENVOY, logger);

    const envoyContainer = await dockerode.createContainer({
      Image: SemanticRouterImage.ENVOY,
      User: '101',
      Cmd: ['envoy', '-c', SemanticRouterContainerManager.ENVOY_CONFIG_CONTAINER_PATH, '-l', this.getLogLevel()],
      Labels: {
        [SemanticRouterLabel.NAME]: params.name,
        [SemanticRouterLabel.ROLE]: SemanticRouterRole.ENVOY,
      },
      HostConfig: {
        NetworkMode: `container:${routerContainer.id}`,
        Binds: [`${envoyConfigFilePath}:${SemanticRouterContainerManager.ENVOY_CONFIG_CONTAINER_PATH}:ro,Z`],
      },
    });
    createdContainers.push(envoyContainer);

    await this.registerInferenceConnection(
      params.name,
      connectionId,
      this.getEndpointHost(envoyHostAddress),
      envoyHostPort,
      apiHostPort,
      dockerode,
      endpointPath,
      routerContainer.id,
      envoyContainer.id,
      false,
    );

    return { connectionId };
  }

  private async registerInferenceConnection(
    name: string,
    connectionId: string,
    envoyHost: string,
    envoyHostPort: number,
    apiHostPort: number,
    dockerode: Dockerode,
    endpointPath: string,
    routerContainerId: string,
    envoyContainerId: string,
    running: boolean,
  ): Promise<void> {
    // discovery runs on every endpoints change and may overlap with another discovery or a creation
    if (this.#connections.has(connectionId)) {
      return;
    }
    const sdk = createOpenAICompatible({
      baseURL: `http://${envoyHost}:${envoyHostPort}/v1`,
      name: `vllm-sr/${name}`,
    });

    const managed: Omit<ManagedConnection, 'disposable'> = {
      routerContainerId,
      envoyContainerId,
      dockerode,
      endpointPath,
      port: envoyHostPort,
      apiPort: apiHostPort,
      running,
      starting: false,
    };

    const disposable = this.provider.registerInferenceProviderConnection({
      id: connectionId,
      name: name,
      type: 'local',
      llmMetadata: { name: 'openai', semanticRouter: name },
      endpoint: `http://${envoyHost}:${envoyHostPort}/v1`,
      sdk,
      status() {
        if (managed.starting) {
          return 'starting';
        }
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
        start: async (_context, logger): Promise<void> => {
          await this.startContainers(dockerode, [routerContainerId, envoyContainerId], name, managed, logger);
        },
        stop: async (): Promise<void> => {
          await this.stopContainers(dockerode, [envoyContainerId, routerContainerId], name, managed);
        },
        delete: async (): Promise<void> => {
          await this.deleteConnection(connectionId, dockerode, routerContainerId, envoyContainerId, name);
        },
      },
    });

    // keep the same object: status() and the lifecycle read and update it
    this.#connections.set(connectionId, Object.assign(managed, { disposable }));
  }

  // 304 Not Modified: the container is already in the requested state
  private isNotModified(err: unknown): boolean {
    return err instanceof Error && 'statusCode' in err && err.statusCode === 304;
  }

  // 404 Not Found: the container does not exist anymore
  private isNotFound(err: unknown): boolean {
    return err instanceof Error && 'statusCode' in err && err.statusCode === 404;
  }

  // containers are started in order and the connection becomes started once the router answers on /ready; if a
  // step fails, the containers already running are stopped again so that the connection is not left half started
  private async startContainers(
    dockerode: Dockerode,
    containerIds: string[],
    name: string,
    managed: Pick<ManagedConnection, 'running' | 'starting' | 'apiPort'>,
    logger?: Logger,
  ): Promise<void> {
    managed.starting = true;
    try {
      const running: string[] = [];
      for (const containerId of containerIds) {
        try {
          await dockerode.getContainer(containerId).start();
        } catch (err: unknown) {
          if (!this.isNotModified(err)) {
            console.error(`vllm-semantic-router: failed to start container ${containerId} for router ${name}`, err);
            await this.rollbackStart(dockerode, running, name, managed);
            throw err;
          }
          // already started
        }
        running.push(containerId);
      }

      try {
        await this.waitForRouterReady(name, managed.apiPort, logger);
      } catch (err: unknown) {
        console.error(`vllm-semantic-router: router ${name} did not become ready`, err);
        await this.rollbackStart(dockerode, running, name, managed);
        throw err;
      }
      managed.running = true;
    } finally {
      managed.starting = false;
    }
  }

  private async rollbackStart(
    dockerode: Dockerode,
    running: string[],
    name: string,
    managed: Pick<ManagedConnection, 'running'>,
  ): Promise<void> {
    try {
      await this.stopContainers(dockerode, running.toReversed(), name, managed);
    } catch (rollbackErr: unknown) {
      console.error(`vllm-semantic-router: failed to roll back start of router ${name}`, rollbackErr);
    }
  }

  private async waitForRouterReady(name: string, apiPort: number, logger?: Logger): Promise<void> {
    let lastProgress: string | undefined;
    await this.networkHelper.waitForHttpOk(`http://127.0.0.1:${apiPort}/ready`, {
      timeout: SemanticRouterContainerManager.READY_TIMEOUT_MS,
      interval: SemanticRouterContainerManager.READY_POLL_INTERVAL_MS,
      onNotReady: async (response: Response): Promise<void> => {
        const progress = await this.getRouterStartupProgress(response);
        if (progress && progress !== lastProgress) {
          lastProgress = progress;
          logger?.log(`Semantic router '${name}' is starting: ${progress}`);
        }
      },
    });
  }

  // the router apiserver describes its startup in the /ready body while it answers 503
  private async getRouterStartupProgress(response: Response): Promise<string | undefined> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (err: unknown) {
      console.warn(`vllm-semantic-router: unexpected /ready response body (HTTP ${response.status})`, err);
      return undefined;
    }
    const result = RouterReadySchema.safeParse(body);
    if (!result.success) {
      return undefined;
    }
    const { downloading_model, message, phase } = result.data;
    if (downloading_model) {
      return `downloading model ${downloading_model}`;
    }
    return message ?? phase;
  }

  // a failure on one container must not prevent stopping the other one or marking the connection as stopped
  private async stopContainers(
    dockerode: Dockerode,
    containerIds: string[],
    name: string,
    managed: Pick<ManagedConnection, 'running'>,
  ): Promise<void> {
    const errors: unknown[] = [];
    for (const containerId of containerIds) {
      try {
        await dockerode.getContainer(containerId).stop();
      } catch (err: unknown) {
        if (this.isNotModified(err)) {
          // already stopped
          continue;
        }
        console.error(`vllm-semantic-router: failed to stop container ${containerId} for router ${name}`, err);
        errors.push(err);
      }
    }
    managed.running = false;
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to stop semantic router '${name}'`);
    }
  }

  private async deleteConnection(
    connectionId: string,
    dockerode: Dockerode,
    routerContainerId: string,
    envoyContainerId: string,
    name: string,
  ): Promise<void> {
    const errors: unknown[] = [];
    for (const containerId of [envoyContainerId, routerContainerId]) {
      const container = dockerode.getContainer(containerId);
      try {
        await container.stop();
      } catch (err: unknown) {
        // already stopped is expected; removal decides whether the delete succeeds
        if (!this.isNotModified(err)) {
          console.error(`vllm-semantic-router: failed to stop container ${containerId} for router ${name}`, err);
        }
      }
      try {
        await container.remove();
      } catch (err: unknown) {
        if (this.isNotFound(err)) {
          // already removed
          continue;
        }
        console.error(`vllm-semantic-router: failed to remove container ${containerId} for router ${name}`, err);
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      // the router still exists: keep its folder and connection so that it stays discoverable and can be deleted again
      throw new AggregateError(errors, `Failed to delete semantic router '${name}'`);
    }

    const routerDir = this.getRouterDir(name);
    try {
      await rm(routerDir, { recursive: true, force: true });
    } finally {
      // the containers are gone: always unregister the connection
      const managed = this.#connections.get(connectionId);
      managed?.disposable.dispose();
      this.#connections.delete(connectionId);
    }
  }

  dispose(): void {
    this.#containersSubscription?.dispose();
    this.#containersSubscription = undefined;
    this.#endpointsSubscription?.dispose();
    this.#endpointsSubscription = undefined;
    this.#factoryDisposable?.dispose();
    this.#factoryDisposable = undefined;
    for (const managed of this.#connections.values()) {
      managed.disposable.dispose();
    }
    this.#connections.clear();
  }
}
