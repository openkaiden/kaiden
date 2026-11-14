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

import { beforeEach, describe, expect, test } from 'vitest';
import { stringify } from 'yaml';

import { SemanticRouterConfigParser } from './semantic-router-config-parser';

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

function configWithModels(models: unknown[]): string {
  return stringify({ ...defaultConfig, providers: { models } });
}

function configWithEndpoint(endpoint: string, protocol = 'http'): string {
  return configWithModels([
    {
      name: 'model-a',
      provider_model_id: 'model-a',
      backend_refs: [{ name: 'primary', endpoint, protocol, weight: 100 }],
    },
  ]);
}

let parser: SemanticRouterConfigParser;

beforeEach(() => {
  parser = new SemanticRouterConfigParser();
});

describe('validateName', () => {
  test.each([
    ['', 'name must not be empty'],
    ['   ', 'name must not be empty'],
    ['a'.repeat(256), 'name must not exceed 255 characters'],
    ['..', 'name must not end with a dot or a space'],
    ['.', 'name must not end with a dot or a space'],
    ['my-router.', 'name must not end with a dot or a space'],
    ['my-router ', 'name must not end with a dot or a space'],
    ['../escape', 'control characters'],
    ['nested/router', 'control characters'],
    ['back\\slash', 'control characters'],
    ['a:b', 'control characters'],
    ['what?', 'control characters'],
    ['star*', 'control characters'],
    ['tab\there', 'control characters'],
    ['CON', 'name is a reserved system name'],
    ['nul.txt', 'name is a reserved system name'],
    ['com1', 'name is a reserved system name'],
  ])('rejects invalid name %j', (name, reason) => {
    expect(() => parser.validateName(name)).toThrow(`Invalid semantic router name '${name}': `);
    expect(() => parser.validateName(name)).toThrow(reason);
  });

  test.each(['my-router', 'My Router_2', 'router.v1', 'console', 'com10'])('accepts valid name %j', name => {
    expect(() => parser.validateName(name)).not.toThrow();
  });
});

describe('parseConfig', () => {
  test('returns the parsed configuration', () => {
    expect(parser.parseConfig(stringify(defaultConfig))).toEqual(defaultConfig);
  });

  test.each([
    ['invalid YAML', 'providers: [unclosed', 'Invalid semantic router configuration'],
    ['a config missing required fields', stringify({ version: 'v0.3' }), 'Invalid semantic router configuration'],
    ['a config with wrong field types', stringify({ ...defaultConfig, listeners: 'nope' }), 'listeners'],
  ])('rejects %s', (_label, config, message) => {
    expect(() => parser.parseConfig(config)).toThrow(message);
  });

  test.each([
    ['no listener', [], 'exactly one listener is required, found 0'],
    [
      'several listeners',
      [
        { name: 'a', address: '127.0.0.1', port: 8899 },
        { name: 'b', address: '127.0.0.1', port: 8900 },
      ],
      'exactly one listener is required, found 2',
    ],
    ['a host name as address', [{ name: 'a', address: 'localhost', port: 8899 }], "listener address 'localhost'"],
    ['a privileged port', [{ name: 'a', address: '127.0.0.1', port: 80 }], 'listener port 80 must be between'],
    ['a port above 65535', [{ name: 'a', address: '127.0.0.1', port: 70000 }], 'listener port 70000'],
    [
      'a timeout without unit',
      [{ name: 'a', address: '127.0.0.1', port: 8899, timeout: '300' }],
      "listener timeout '300'",
    ],
    ['a zero timeout', [{ name: 'a', address: '127.0.0.1', port: 8899, timeout: '0s' }], "listener timeout '0s'"],
  ])('rejects %s', (_label, listeners, message) => {
    expect(() => parser.parseConfig(stringify({ ...defaultConfig, listeners }))).toThrow(message);
  });

  test.each([
    ['an automatic port', { name: 'a', address: '127.0.0.1', port: -1 }],
    ['an IPv6 address', { name: 'a', address: '::1', port: 8899 }],
    ['a timeout', { name: 'a', address: '0.0.0.0', port: 65535, timeout: '120s' }],
  ])('accepts a listener with %s', (_label, listener) => {
    expect(() => parser.parseConfig(stringify({ ...defaultConfig, listeners: [listener] }))).not.toThrow();
  });

  test('rejects duplicate model names', () => {
    const config = configWithModels([
      {
        name: 'model-a',
        provider_model_id: 'model-a',
        backend_refs: [{ name: 'primary', endpoint: 'host-a:8000', protocol: 'http', weight: 100 }],
      },
      {
        name: 'model-a',
        provider_model_id: 'model-a',
        backend_refs: [{ name: 'primary', endpoint: 'host-b:9000', protocol: 'http', weight: 100 }],
      },
    ]);

    expect(() => parser.parseConfig(config)).toThrow(
      `Invalid semantic router configuration: model 'model-a' is defined more than once`,
    );
  });

  test.each([
    ['no backend_refs entry', [], 0],
    [
      'several backend_refs entries',
      [
        { name: 'primary', endpoint: 'host-a:8000', protocol: 'http', weight: 80 },
        { name: 'secondary', endpoint: 'host-b:8000', protocol: 'http', weight: 20 },
      ],
      2,
    ],
  ])('rejects a model with %s', (_label, backendRefs, count) => {
    const config = configWithModels([{ name: 'model-a', provider_model_id: 'model-a', backend_refs: backendRefs }]);

    expect(() => parser.parseConfig(config)).toThrow(
      `model 'model-a' must have exactly one backend_refs entry, found ${count}`,
    );
  });

  test.each(['HTTPS', 'grpc', ''])('rejects backend protocol %j', protocol => {
    expect(() => parser.parseConfig(configWithEndpoint('host:8000', protocol))).toThrow(
      'Invalid semantic router configuration',
    );
    expect(() => parser.parseConfig(configWithEndpoint('host:8000', protocol))).toThrow('protocol');
  });

  test.each(['http', 'https'])('accepts backend protocol %j', protocol => {
    expect(() => parser.parseConfig(configWithEndpoint('host:8000', protocol))).not.toThrow();
  });

  test.each([
    ['host:notaport', 'expected host[:port]'],
    ['host:70000', 'expected host[:port]'],
    ['::1:8000', 'expected host[:port]'],
    ['http://host:8000', 'the endpoint must not include a scheme'],
    [':8000', 'expected host[:port]'],
  ])('rejects backend endpoint %j', (endpoint, reason) => {
    expect(() => parser.parseConfig(configWithEndpoint(endpoint))).toThrow(
      `model 'model-a' has invalid endpoint '${endpoint}': ${reason}`,
    );
  });
});

describe('parseBackendEndpoint', () => {
  test.each([
    ['host:8000/v1', 'http', 'host', 8000],
    ['localhost/v1', 'http', 'localhost', 80],
    ['my-backend', 'http', 'my-backend', 80],
    ['api.example.com', 'https', 'api.example.com', 443],
    ['[::1]:8000', 'http', '::1', 8000],
    ['[2001:db8::1]', 'https', '2001:db8::1', 443],
  ])('parses %j (%s)', (endpoint, protocol, hostname, port) => {
    const model = { name: 'model-a', provider_model_id: 'model-a', backend_refs: [] };

    expect(parser.parseBackendEndpoint(model, { name: 'primary', endpoint, protocol, weight: 100 })).toEqual({
      hostname,
      port,
    });
  });
});
