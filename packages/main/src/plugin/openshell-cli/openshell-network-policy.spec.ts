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

import { create } from '@bufbuild/protobuf';
import { NetworkAccessPreset, NetworkEndpointSchema, SandboxPolicySchema } from '@nvidia/openshell-sdk/raw';
import { describe, expect, test } from 'vitest';

import { OPENSHELL_CONTAINER_HOST, OpenshellNetworkPolicy } from './openshell-network-policy.js';

const networkPolicy = new OpenshellNetworkPolicy();

describe('parseNetworkDestination', () => {
  test('parses a hostname without a port', () => {
    expect(networkPolicy.parseNetworkDestination('registry.npmjs.org')).toEqual({ host: 'registry.npmjs.org' });
  });

  test('parses a hostname with an explicit port', () => {
    expect(networkPolicy.parseNetworkDestination('api.example.com:8080')).toEqual({
      host: 'api.example.com',
      port: 8080,
    });
  });

  test.each([
    '[2001:db8::1]:8443',
    '2001:db8::1',
    'api.example.com:0',
    'api.example.com:65536',
    'api.example.com:https',
    'api.example.com:',
    ':8080',
    '',
  ])('rejects invalid destination %j', destination => {
    expect(networkPolicy.parseNetworkDestination(destination)).toBeUndefined();
  });
});

describe('rewriteLocalhostUrl', () => {
  test('rewrites localhost to host.openshell.internal', () => {
    expect(networkPolicy.rewriteLocalhostUrl('http://localhost:11434/v1')).toBe(
      `http://${OPENSHELL_CONTAINER_HOST}:11434/v1`,
    );
  });

  test('rewrites 127.0.0.1 to host.openshell.internal', () => {
    expect(networkPolicy.rewriteLocalhostUrl('http://127.0.0.1:11434/v1')).toBe(
      `http://${OPENSHELL_CONTAINER_HOST}:11434/v1`,
    );
  });

  test('rewrites 0.0.0.0 to host.openshell.internal', () => {
    expect(networkPolicy.rewriteLocalhostUrl('http://0.0.0.0:8080/v1')).toBe(
      `http://${OPENSHELL_CONTAINER_HOST}:8080/v1`,
    );
  });

  test('does not rewrite external URLs', () => {
    expect(networkPolicy.rewriteLocalhostUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
  });

  test('returns invalid strings unchanged', () => {
    expect(networkPolicy.rewriteLocalhostUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('parseModelEndpoint', () => {
  test('parses HTTPS URL with default port', () => {
    expect(networkPolicy.parseModelEndpoint('https://api.example.com/v1')).toEqual({
      host: 'api.example.com',
      port: 443,
    });
  });

  test('parses HTTP URL with default port', () => {
    expect(networkPolicy.parseModelEndpoint('http://api.example.com/v1')).toEqual({
      host: 'api.example.com',
      port: 80,
    });
  });

  test('parses URL with explicit port', () => {
    expect(networkPolicy.parseModelEndpoint('https://api.example.com:8443/v1')).toEqual({
      host: 'api.example.com',
      port: 8443,
    });
  });

  test('rewrites localhost and parses', () => {
    expect(networkPolicy.parseModelEndpoint('http://localhost:11434/v1')).toEqual({
      host: OPENSHELL_CONTAINER_HOST,
      port: 11434,
    });
  });

  test('rewrites 127.0.0.1 and parses', () => {
    expect(networkPolicy.parseModelEndpoint('http://127.0.0.1:11434/v1')).toEqual({
      host: OPENSHELL_CONTAINER_HOST,
      port: 11434,
    });
  });

  test('returns undefined for invalid URL', () => {
    expect(networkPolicy.parseModelEndpoint('not-a-url')).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(networkPolicy.parseModelEndpoint('')).toBeUndefined();
  });

  test('returns undefined for unknown scheme without explicit port', () => {
    expect(networkPolicy.parseModelEndpoint('ftp://files.example.com/data')).toBeUndefined();
  });

  test('parses unknown scheme when explicit port is provided', () => {
    expect(networkPolicy.parseModelEndpoint('ftp://files.example.com:2121/data')).toEqual({
      host: 'files.example.com',
      port: 2121,
    });
  });
});

describe('buildPolicyObject', () => {
  test('returns undefined when no network and no model endpoint', () => {
    expect(networkPolicy.buildPolicyObject()).toBeUndefined();
  });

  test('returns undefined for allow mode with no model endpoint', () => {
    expect(networkPolicy.buildPolicyObject({ mode: 'allow' })).toBeUndefined();
  });

  test('returns undefined for deny mode with no hosts and no model endpoint', () => {
    expect(networkPolicy.buildPolicyObject({ mode: 'deny' })).toBeUndefined();
  });

  test('returns undefined for deny mode with empty hosts and no model endpoint', () => {
    expect(networkPolicy.buildPolicyObject({ mode: 'deny', hosts: [] })).toBeUndefined();
  });

  test('builds network rule for deny mode with hosts', () => {
    const policy = networkPolicy.buildPolicyObject({ mode: 'deny', hosts: ['registry.npmjs.org'] });

    expect(policy).toEqual(
      create(SandboxPolicySchema, {
        version: 1,
        networkPolicies: {
          'kdn-network': {
            endpoints: [
              {
                host: 'registry.npmjs.org',
                port: 443,
                protocol: 'rest',
                access: NetworkAccessPreset.FULL,
                allowEncodedSlash: true,
              },
              {
                host: 'registry.npmjs.org',
                port: 80,
                protocol: 'rest',
                access: NetworkAccessPreset.FULL,
                allowEncodedSlash: true,
              },
            ],
            binaries: [{ path: '/**' }],
          },
        },
      }),
    );
  });

  test('builds one endpoint for a host with an explicit port', () => {
    const policy = networkPolicy.buildPolicyObject({ mode: 'deny', hosts: ['api.example.com:8080'] });

    expect(policy!.networkPolicies!['kdn-network']!.endpoints).toEqual([
      create(NetworkEndpointSchema, {
        host: 'api.example.com',
        port: 8080,
        protocol: 'rest',
        access: NetworkAccessPreset.FULL,
        allowEncodedSlash: true,
      }),
    ]);
  });

  test('omits invalid destinations', () => {
    expect(networkPolicy.buildPolicyObject({ mode: 'deny', hosts: ['api.example.com:99999'] })).toBeUndefined();
  });

  test('builds model rule for valid endpoint', () => {
    const policy = networkPolicy.buildPolicyObject(undefined, 'https://api.example.com/v1');

    expect(policy).toEqual(
      create(SandboxPolicySchema, {
        version: 1,
        networkPolicies: {
          'kdn-model': {
            endpoints: [{ host: 'api.example.com', port: 443 }],
            binaries: [{ path: '/**' }],
          },
        },
      }),
    );
  });

  test('combines network and model rules', () => {
    const policy = networkPolicy.buildPolicyObject(
      { mode: 'deny', hosts: ['registry.npmjs.org'] },
      'http://localhost:11434/v1',
    );

    expect(policy).toEqual(
      create(SandboxPolicySchema, {
        version: 1,
        networkPolicies: {
          'kdn-network': {
            endpoints: [
              {
                host: 'registry.npmjs.org',
                port: 443,
                protocol: 'rest',
                access: NetworkAccessPreset.FULL,
                allowEncodedSlash: true,
              },
              {
                host: 'registry.npmjs.org',
                port: 80,
                protocol: 'rest',
                access: NetworkAccessPreset.FULL,
                allowEncodedSlash: true,
              },
            ],
            binaries: [{ path: '/**' }],
          },
          'kdn-model': {
            endpoints: [{ host: OPENSHELL_CONTAINER_HOST, port: 11434 }],
            binaries: [{ path: '/**' }],
          },
        },
      }),
    );
  });

  test('rewrites localhost model endpoint', () => {
    const policy = networkPolicy.buildPolicyObject(undefined, 'http://localhost:11434/v1');

    expect(policy!.networkPolicies!['kdn-model']!.endpoints![0]!.host).toBe(OPENSHELL_CONTAINER_HOST);
  });

  test('returns only model rule when network is allow mode', () => {
    const policy = networkPolicy.buildPolicyObject({ mode: 'allow' }, 'https://api.example.com/v1');

    expect(Object.keys(policy!.networkPolicies!)).toEqual(['kdn-model']);
  });

  test('returns undefined for invalid model endpoint with no network', () => {
    expect(networkPolicy.buildPolicyObject(undefined, 'not-a-url')).toBeUndefined();
  });
});

describe('endpointMatchesHost', () => {
  test('matches identical hosts', () => {
    expect(networkPolicy.endpointMatchesHost('api.openai.com', 'api.openai.com')).toBeTruthy();
  });

  test('does not match different hosts', () => {
    expect(networkPolicy.endpointMatchesHost('api.openai.com', 'api.anthropic.com')).toBeFalsy();
  });

  test('matches wildcard * against any host', () => {
    expect(networkPolicy.endpointMatchesHost('*', 'api.openai.com')).toBeTruthy();
  });

  test('matches glob pattern *.example.com', () => {
    expect(networkPolicy.endpointMatchesHost('*.example.com', 'api.example.com')).toBeTruthy();
  });

  test('does not match glob pattern against non-matching host', () => {
    expect(networkPolicy.endpointMatchesHost('*.example.com', 'api.other.com')).toBeFalsy();
  });

  test('matches rewritten container host exactly', () => {
    expect(networkPolicy.endpointMatchesHost(OPENSHELL_CONTAINER_HOST, OPENSHELL_CONTAINER_HOST)).toBeTruthy();
  });
});

describe('isEndpointCovered', () => {
  test('returns true when exact host and port match', () => {
    const endpoints = [create(NetworkEndpointSchema, { host: 'api.openai.com', port: 443 })];
    expect(networkPolicy.isEndpointCovered(endpoints, { host: 'api.openai.com', port: 443 })).toBeTruthy();
  });

  test('returns false when host matches but port differs', () => {
    const endpoints = [create(NetworkEndpointSchema, { host: 'api.openai.com', port: 80 })];
    expect(networkPolicy.isEndpointCovered(endpoints, { host: 'api.openai.com', port: 443 })).toBeFalsy();
  });

  test('returns true when wildcard host covers the target', () => {
    const endpoints = [create(NetworkEndpointSchema, { host: '*', port: 443 })];
    expect(networkPolicy.isEndpointCovered(endpoints, { host: 'api.openai.com', port: 443 })).toBeTruthy();
  });

  test('returns false for empty endpoints list', () => {
    expect(networkPolicy.isEndpointCovered([], { host: 'api.openai.com', port: 443 })).toBeFalsy();
  });

  test('returns true when one of several endpoints matches', () => {
    const endpoints = [
      create(NetworkEndpointSchema, { host: 'api.anthropic.com', port: 443 }),
      create(NetworkEndpointSchema, { host: 'api.openai.com', port: 443 }),
    ];
    expect(networkPolicy.isEndpointCovered(endpoints, { host: 'api.openai.com', port: 443 })).toBeTruthy();
  });
});

describe('extractBinaryFromCommand', () => {
  test('extracts single-word command', () => {
    expect(networkPolicy.extractBinaryFromCommand('claude')).toBe('claude');
  });

  test('extracts first word from multi-word command', () => {
    expect(networkPolicy.extractBinaryFromCommand('/usr/bin/agent start')).toBe('/usr/bin/agent');
  });

  test('trims whitespace', () => {
    expect(networkPolicy.extractBinaryFromCommand('  claude  ')).toBe('claude');
  });
});

describe('isAgentCommandAllowed', () => {
  test('matches exact path when binary has no wildcard', () => {
    expect(networkPolicy.isAgentCommandAllowed('/usr/bin/claude', ['/usr/bin/claude', '/usr/bin/node'])).toBe(true);
  });

  test('rejects path not equal when binary has no wildcard', () => {
    expect(networkPolicy.isAgentCommandAllowed('/usr/bin/claude', ['/usr/local/bin/claude'])).toBe(false);
  });

  test('matches bare command exactly when binary has no wildcard', () => {
    expect(networkPolicy.isAgentCommandAllowed('claude', ['claude'])).toBe(true);
  });

  test('rejects bare command against absolute binary without wildcard', () => {
    expect(networkPolicy.isAgentCommandAllowed('claude', ['/usr/local/bin/claude', '/usr/bin/node'])).toBe(false);
  });

  test('matches via glob when binary contains wildcard', () => {
    expect(networkPolicy.isAgentCommandAllowed('/usr/local/bin/claude', ['**/claude'])).toBe(true);
  });

  test('rejects via glob when pattern does not match', () => {
    expect(networkPolicy.isAgentCommandAllowed('/usr/bin/node', ['**/claude'])).toBe(false);
  });

  test('matches bare command via glob pattern', () => {
    expect(networkPolicy.isAgentCommandAllowed('claude', ['**/claude'])).toBe(true);
  });
});
