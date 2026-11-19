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

import { Container } from 'inversify';
import { beforeEach, expect, test, vi } from 'vitest';
import { parse } from 'yaml';

import { type EnvoyConfig, EnvoyConfigSchema } from '/@/api/envoy-config-schema';
import { type SRConfig, SRConfigSchema } from '/@/api/sr-config-schema';

import { EnvoyConfigGenerator } from './envoy-config-generator';
import { NetworkHelper } from './network-helper';
import { SemanticRouterConfigParser } from './semantic-router-config-parser';

vi.mock(import('./network-helper'));

const defaultConfig = {
  version: 'v0.3',
  listeners: [{ name: 'http-8080', address: '0.0.0.0', port: 8080 }],
  providers: {
    models: [
      {
        name: 'gpt-4',
        provider_model_id: 'gpt-4',
        backend_refs: [{ name: 'primary', endpoint: 'localhost:8000', protocol: 'http', weight: 100 }],
      },
    ],
  },
  routing: {
    signals: { keywords: [] },
    modelCards: [{ name: 'gpt-4', modality: 'text', capabilities: ['chat'] }],
    decisions: [],
  },
  global: {
    services: { router_replay: { enabled: true, store_backend: 'memory' } },
  },
};

function srConfigWithModels(models: unknown[]): SRConfig {
  return SRConfigSchema.parse({ ...defaultConfig, providers: { models } });
}

function model(name: string, endpoint: string, protocol = 'http'): unknown {
  return { name, provider_model_id: name, backend_refs: [{ name: 'primary', endpoint, protocol, weight: 100 }] };
}

// the generated content, parsed and validated with the envoy config schema
function generate(srConfig: SRConfig): EnvoyConfig {
  return EnvoyConfigSchema.parse(parse(generator.generate(srConfig)));
}

function clusterOf(
  envoyConfig: EnvoyConfig,
  name: string,
): EnvoyConfig['static_resources']['clusters'][number] | undefined {
  return envoyConfig.static_resources.clusters.find(c => c.name === name);
}

function socketAddressOf(
  envoyConfig: EnvoyConfig,
  clusterName: string,
): { address: string; port_value: number } | undefined {
  return clusterOf(envoyConfig, clusterName)?.load_assignment.endpoints[0]?.lb_endpoints[0]?.endpoint.address
    .socket_address;
}

let generator: EnvoyConfigGenerator;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(NetworkHelper.prototype.convertHost).mockReturnValue('converted-host');
  const container = new Container();
  container.bind(EnvoyConfigGenerator).toSelf();
  container.bind(SemanticRouterConfigParser).toSelf();
  container.bind(NetworkHelper).toSelf();
  generator = await container.getAsync(EnvoyConfigGenerator);
});

test('calls the router over gRPC in the shared network namespace and listens on the envoy port', () => {
  const envoyConfig = generate(SRConfigSchema.parse(defaultConfig));

  expect(clusterOf(envoyConfig, 'extproc_service')?.type).toBe('STATIC');
  expect(socketAddressOf(envoyConfig, 'extproc_service')).toEqual({ address: '127.0.0.1', port_value: 50051 });
  expect(envoyConfig.static_resources.listeners[0]?.address.socket_address.port_value).toBe(8801);
  expect(envoyConfig.admin?.address.socket_address.port_value).toBe(9901);
});

test('routes each model to its backend through the converted host', () => {
  const envoyConfig = generate(SRConfigSchema.parse(defaultConfig));

  expect(NetworkHelper.prototype.convertHost).toHaveBeenCalledWith('localhost');
  expect(socketAddressOf(envoyConfig, 'gpt-4')).toEqual({ address: 'converted-host', port_value: 8000 });
});

test('selects the model route with the x-selected-model header set by the router', () => {
  const envoyConfig = generate(SRConfigSchema.parse(defaultConfig));

  const routes =
    envoyConfig.static_resources.listeners[0]?.filter_chains[0]?.filters[0]?.typed_config.route_config.virtual_hosts[0]
      ?.routes;
  expect(routes).toEqual([
    {
      match: { prefix: '/', headers: [{ name: 'x-selected-model', string_match: { exact: 'gpt-4' } }] },
      route: { cluster: 'gpt-4', host_rewrite_literal: 'converted-host' },
    },
    // no model selected
    { match: { prefix: '/' }, direct_response: { status: 503 } },
  ]);
});

test('generates one cluster per model', () => {
  const envoyConfig = generate(
    srConfigWithModels([
      model('model-a', 'host-a:8000'),
      model('model-b', 'host-b:9000'),
      model('model-c', 'host-a:8000'),
    ]),
  );

  expect(envoyConfig.static_resources.clusters.map(c => c.name)).toEqual([
    'extproc_service',
    'model-a',
    'model-b',
    'model-c',
  ]);
});

test.each([
  ['host:8000/v1', 'http', 'host', 8000],
  ['my-backend', 'http', 'my-backend', 80],
  ['api.example.com', 'https', 'api.example.com', 443],
  ['[::1]:8000', 'http', '::1', 8000],
])('uses the parsed backend endpoint %j (%s)', (endpoint, protocol, hostname, port) => {
  const envoyConfig = generate(srConfigWithModels([model('model-a', endpoint, protocol)]));

  expect(NetworkHelper.prototype.convertHost).toHaveBeenCalledWith(hostname);
  expect(socketAddressOf(envoyConfig, 'model-a')?.port_value).toBe(port);
});

test('adds TLS with the backend host as SNI for https backends only', () => {
  const envoyConfig = generate(
    srConfigWithModels([model('secure', 'api.example.com', 'https'), model('plain', 'host:8000')]),
  );

  expect(clusterOf(envoyConfig, 'secure')?.transport_socket).toEqual(
    expect.objectContaining({
      name: 'envoy.transport_sockets.tls',
      typed_config: expect.objectContaining({ sni: 'converted-host' }),
    }),
  );
  expect(clusterOf(envoyConfig, 'plain')?.transport_socket).toBeUndefined();
});

test.each([
  ['the listener timeout', '120s', '120s'],
  ['300s without listener timeout', undefined, '300s'],
])('uses %s for the envoy timeouts', (_label, timeout, expected) => {
  const envoyConfig = generate(
    SRConfigSchema.parse({ ...defaultConfig, listeners: [{ name: 'http', address: '127.0.0.1', port: 0, timeout }] }),
  );

  const connectionManager = envoyConfig.static_resources.listeners[0]?.filter_chains[0]?.filters[0]?.typed_config;
  expect(connectionManager?.request_timeout).toBe(expected);
  expect(connectionManager?.stream_idle_timeout).toBe(expected);
  const extProc = connectionManager?.http_filters.find(f => f.name === 'envoy.filters.http.ext_proc');
  expect(extProc?.typed_config.message_timeout).toBe(expected);
});
