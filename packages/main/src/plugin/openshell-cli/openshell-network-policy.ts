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

import { isIPv6 } from 'node:net';

import type { MessageInitShape } from '@bufbuild/protobuf';
import type { NetworkEndpointSchema, SandboxPolicySchema } from '@nvidia/openshell-sdk/raw';

import type { NetworkConfiguration } from '/@api/agent-workspace-info.js';

export type OpenshellPolicy = MessageInitShape<typeof SandboxPolicySchema>;

// ── Policy endpoint builder ───────────────────────────────────────

const NETWORK_RULE_NAME = 'kdn-network';
const MODEL_RULE_NAME = 'kdn-model';

export const OPENSHELL_CONTAINER_HOST = 'host.openshell.internal';

const LOCALHOST_ALIASES = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'];

// ── Model endpoint policy ─────────────────────────────────────────

export interface ModelEndpoint {
  host: string;
  port: number;
}

export interface NetworkDestination {
  host: string;
  port?: number;
}

/**
 * Parses a network destination stored as either `host` or `host:port`.
 * IPv6 destinations are not supported by this workspace configuration.
 */
export function parseNetworkDestination(destination: string): NetworkDestination | undefined {
  const value = destination.trim();
  if (!value || value.endsWith(':')) return undefined;

  let parsed: URL;
  try {
    // A non-special scheme preserves explicit default ports such as 80 and 443.
    parsed = new URL(`kdn://${value}`);
  } catch {
    return undefined;
  }

  if (parsed.username || parsed.password || parsed.pathname || parsed.search || parsed.hash) return undefined;

  const host = parsed.hostname;
  const unbracketedHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (!host || isIPv6(unbracketedHost)) return undefined;

  if (!parsed.port) return { host };

  const port = Number(parsed.port);
  return port > 0 ? { host, port } : undefined;
}

/**
 * Rewrites localhost URLs to {@link OPENSHELL_CONTAINER_HOST} so the
 * sandbox can reach host-local model servers (e.g. Ollama).
 */
export function rewriteLocalhostUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (!LOCALHOST_ALIASES.includes(parsed.hostname.toLowerCase())) {
    return rawUrl;
  }

  parsed.hostname = OPENSHELL_CONTAINER_HOST;
  return parsed.toString();
}

/**
 * Extracts host and port from an inference endpoint URL. Localhost
 * aliases are rewritten to {@link OPENSHELL_CONTAINER_HOST}.
 */
export function parseModelEndpoint(endpoint: string): ModelEndpoint | undefined {
  const rewritten = rewriteLocalhostUrl(endpoint);
  let parsed: URL;
  try {
    parsed = new URL(rewritten);
  } catch {
    return undefined;
  }

  if (!parsed.hostname) {
    return undefined;
  }

  let port: number;
  if (parsed.port) {
    port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return undefined;
    }
  } else {
    if (parsed.protocol === 'https:') {
      port = 443;
    } else if (parsed.protocol === 'http:') {
      port = 80;
    } else {
      return undefined;
    }
  }

  return { host: parsed.hostname, port };
}

export function buildPolicyObject(network?: NetworkConfiguration, modelEndpoint?: string): OpenshellPolicy | undefined {
  const networkPolicies: NonNullable<OpenshellPolicy['networkPolicies']> = {};

  if (network && network.mode !== 'allow' && network.hosts?.length) {
    const endpoints: MessageInitShape<typeof NetworkEndpointSchema>[] = network.hosts.flatMap(destination => {
      const parsed = parseNetworkDestination(destination);
      if (!parsed) return [];

      const ports = parsed.port === undefined ? [443, 80] : [parsed.port];
      return ports.map(port => ({
        host: parsed.host,
        port,
        protocol: 'rest' as const,
        access: 'full' as const,
        allowEncodedSlash: true,
      }));
    });
    if (endpoints.length > 0) {
      networkPolicies[NETWORK_RULE_NAME] = {
        endpoints,
        binaries: [{ path: '/**' }],
      };
    }
  }

  if (modelEndpoint) {
    const parsed = parseModelEndpoint(modelEndpoint);
    if (parsed) {
      networkPolicies[MODEL_RULE_NAME] = {
        endpoints: [{ host: parsed.host, port: parsed.port }],
        binaries: [{ path: '/**' }],
      };
    }
  }

  if (Object.keys(networkPolicies).length === 0) {
    return undefined;
  }

  return { version: 1, networkPolicies };
}
