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
import type { SandboxPolicySchema } from '@nvidia/openshell-sdk/raw';
import z from 'zod';

import type { NetworkConfiguration } from '/@api/agent-workspace-info.js';

// ── OpenShell sandbox policy schema ────────────────────────────────

export const OpenshellRestAllowRuleSchema = z.object({
  allow: z.object({
    method: z.string(),
    path: z.string(),
    query: z.record(z.string(), z.union([z.string(), z.object({ any: z.array(z.string()) })])).optional(),
  }),
});

export const OpenshellGraphqlAllowRuleSchema = z.object({
  allow: z.object({
    operation_type: z.string(),
    operation_name: z.string().optional(),
    fields: z.array(z.string()).optional(),
  }),
});

export const OpenshellRestDenyRuleSchema = z.object({
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.union([z.string(), z.object({ any: z.array(z.string()) })])).optional(),
});

export const OpenshellGraphqlDenyRuleSchema = z.object({
  operation_type: z.string(),
  operation_name: z.string().optional(),
  fields: z.array(z.string()).optional(),
});

export const OpenshellEndpointSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  path: z.string().optional(),
  protocol: z.enum(['rest', 'websocket', 'graphql']).optional(),
  tls: z.string().optional(),
  enforcement: z.enum(['enforce', 'audit']).optional(),
  access: z.enum(['read-only', 'read-write', 'full']).optional(),
  rules: z.array(z.union([OpenshellRestAllowRuleSchema, OpenshellGraphqlAllowRuleSchema])).optional(),
  deny_rules: z.array(z.union([OpenshellRestDenyRuleSchema, OpenshellGraphqlDenyRuleSchema])).optional(),
  allowed_ips: z.array(z.string()).optional(),
  allow_encoded_slash: z.boolean().optional(),
  websocket_credential_rewrite: z.boolean().optional(),
  request_body_credential_rewrite: z.boolean().optional(),
  persisted_queries: z.string().optional(),
  graphql_persisted_queries: z
    .record(
      z.string(),
      z.object({
        operation_type: z.string(),
        operation_name: z.string().optional(),
        fields: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  graphql_max_body_bytes: z.number().int().optional(),
});

export type OpenshellEndpoint = z.output<typeof OpenshellEndpointSchema>;

export const OpenshellBinarySchema = z.object({
  path: z.string(),
});

export type OpenshellBinary = z.output<typeof OpenshellBinarySchema>;

export const OpenshellNetworkPolicyEntrySchema = z.object({
  name: z.string().optional(),
  endpoints: z.array(OpenshellEndpointSchema),
  binaries: z.array(OpenshellBinarySchema),
});

export type OpenshellNetworkPolicyEntry = z.output<typeof OpenshellNetworkPolicyEntrySchema>;

export const OpenshellFilesystemPolicySchema = z.object({
  include_workdir: z.boolean().optional(),
  read_only: z.array(z.string()).optional(),
  read_write: z.array(z.string()).optional(),
});

export const OpenshellLandlockSchema = z.object({
  compatibility: z.enum(['best_effort', 'hard_requirement']).optional(),
});

export const OpenshellProcessSchema = z.object({
  run_as_user: z.string().optional(),
  run_as_group: z.string().optional(),
});

export const OpenshellPolicySchema = z.object({
  version: z.literal(1),
  filesystem_policy: OpenshellFilesystemPolicySchema.optional(),
  landlock: OpenshellLandlockSchema.optional(),
  process: OpenshellProcessSchema.optional(),
  network_policies: z.record(z.string(), OpenshellNetworkPolicyEntrySchema).optional(),
});

export type OpenshellPolicy = z.output<typeof OpenshellPolicySchema>;

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
 * IPv6 is rejected because OpenShell endpoint flags use colon delimiters.
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

/**
 * Formats an {@link OpenshellEndpoint} as a CLI `--add-endpoint` string:
 * `host:port[:access[:protocol[:enforcement[:options]]]]`
 */
export function formatEndpointFlag(ep: OpenshellEndpoint): string {
  const parts: string[] = [ep.host, String(ep.port)];
  if (ep.access) parts.push(ep.access);
  if (ep.protocol) parts.push(ep.protocol);
  if (ep.enforcement) parts.push(ep.enforcement);

  const options: string[] = [];
  if (ep.websocket_credential_rewrite) options.push('websocket-credential-rewrite');
  if (ep.request_body_credential_rewrite) options.push('request-body-credential-rewrite');
  if (options.length) {
    if (!ep.enforcement) parts.push('enforce');
    parts.push(options.join(','));
  }

  return parts.join(':');
}

/**
 * Collects all endpoints from a policy's network_policies into CLI
 * `--add-endpoint` formatted strings.
 */
export function collectEndpointFlags(policy: OpenshellPolicy): string[] {
  if (!policy.network_policies) return [];
  return Object.values(policy.network_policies).flatMap(rule => rule.endpoints.map(formatEndpointFlag));
}

export function collectBinaryFlags(policy: OpenshellPolicy): string[] {
  if (!policy.network_policies) return [];
  return [...new Set(Object.values(policy.network_policies).flatMap(rule => (rule.binaries ?? []).map(b => b.path)))];
}

/** Converts the legacy CLI endpoint/binary arguments into the SDK policy shape. */
export function buildSdkNetworkPolicy(
  endpoints: string[],
  binaries: string[] = [],
): MessageInitShape<typeof SandboxPolicySchema> {
  const parsedEndpoints = endpoints.map(endpoint => {
    const [host, rawPort, access = '', protocol = '', enforcement = '', rawOptions = ''] = endpoint.split(':');
    const port = Number(rawPort);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid OpenShell endpoint: ${endpoint}`);
    }
    const options = new Set(rawOptions.split(',').filter(Boolean));
    return {
      host,
      port,
      access,
      protocol,
      enforcement,
      websocketCredentialRewrite: options.has('websocket-credential-rewrite'),
      requestBodyCredentialRewrite: options.has('request-body-credential-rewrite'),
    };
  });

  return {
    version: 1,
    networkPolicies: {
      [NETWORK_RULE_NAME]: {
        name: NETWORK_RULE_NAME,
        endpoints: parsedEndpoints,
        binaries: binaries.map(path => ({ path })),
      },
    },
  };
}

export function buildPolicyObject(network?: NetworkConfiguration, modelEndpoint?: string): OpenshellPolicy | undefined {
  const networkPolicies: Record<string, OpenshellNetworkPolicyEntry> = {};

  if (network && network.mode !== 'allow' && network.hosts?.length) {
    const endpoints: OpenshellEndpoint[] = network.hosts.flatMap(destination => {
      const parsed = parseNetworkDestination(destination);
      if (!parsed) return [];

      const ports = parsed.port === undefined ? [443, 80] : [parsed.port];
      return ports.map(port => ({
        host: parsed.host,
        port,
        protocol: 'rest' as const,
        access: 'full' as const,
        allow_encoded_slash: true,
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

  return { version: 1, network_policies: networkPolicies };
}
