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

import { inject, injectable } from 'inversify';
import { stringify } from 'yaml';

import type { EnvoyCluster, EnvoyConfig, EnvoyRoute, EnvoyRouteCluster } from '/@/api/envoy-config-schema';
import { SemanticRouterPort } from '/@/api/semantic-router-container-info';
import type { SRConfig, SRModel } from '/@/api/sr-config-schema';
import { NetworkHelper } from '/@/helper/network-helper';
import { SemanticRouterConfigParser } from '/@/helper/semantic-router-config-parser';

type ModelInfo = { cluster: EnvoyCluster; route: EnvoyRoute };

@injectable()
export class EnvoyConfigGenerator {
  private static readonly DEFAULT_TIMEOUT = '300s';

  @inject(SemanticRouterConfigParser)
  private configParser: SemanticRouterConfigParser;

  @inject(NetworkHelper)
  private networkHelper: NetworkHelper;

  /**
   * Generates the Envoy configuration of a router: an ext_proc filter calling the router over gRPC, then one route and
   * cluster per model, selected by the x-selected-model header set by the router.
   */
  generate(srConfig: SRConfig): string {
    // parseConfig already ensured exactly one listener
    const timeout = srConfig.listeners[0]?.timeout ?? EnvoyConfigGenerator.DEFAULT_TIMEOUT;
    const models = this.extractModels(srConfig);

    const config: EnvoyConfig = {
      static_resources: {
        listeners: [
          {
            name: 'listener_0',
            address: {
              socket_address: { address: '0.0.0.0', port_value: SemanticRouterPort.ENVOY_LISTEN },
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
                            '@type': 'type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor',
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
                            message_timeout: timeout,
                          },
                        },
                        {
                          name: 'envoy.filters.http.router',
                          typed_config: {
                            '@type': 'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router',
                          },
                        },
                      ],
                      stream_idle_timeout: timeout,
                      request_timeout: timeout,
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
            type: 'STATIC',
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
                            // envoy shares the router network namespace
                            address: '127.0.0.1',
                            port_value: SemanticRouterPort.ROUTER_GRPC,
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
          socket_address: { address: '0.0.0.0', port_value: SemanticRouterPort.ENVOY_ADMIN },
        },
      },
    };

    return stringify(config);
  }

  private extractModels(srConfig: SRConfig): ModelInfo[] {
    // parseConfig already rejected duplicate model names
    return srConfig.providers.models.map(model => this.buildModelInfo(model));
  }

  private buildModelInfo(model: SRModel): ModelInfo {
    // parseConfig already ensured exactly one valid backend
    const ref = model.backend_refs[0];
    const { hostname, port } = this.configParser.parseBackendEndpoint(model, ref);
    const host = this.networkHelper.convertHost(hostname);
    const clusterName = model.name;

    const route: EnvoyRouteCluster = {
      cluster: clusterName,
      host_rewrite_literal: host,
    };
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
                      socket_address: { address: host, port_value: port },
                    },
                    hostname: host,
                  },
                },
              ],
            },
          ],
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
      },
    };
    modelInfo.route.route = route;
    if (ref.protocol === 'https') {
      modelInfo.cluster.transport_socket = {
        name: 'envoy.transport_sockets.tls',
        typed_config: {
          '@type': 'type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.UpstreamTlsContext',
          sni: host,
          common_tls_context: {
            tls_params: {
              tls_minimum_protocol_version: 'TLSv1_2',
              tls_maximum_protocol_version: 'TLSv1_3',
            },
          },
        },
      };
    }

    return modelInfo;
  }
}
