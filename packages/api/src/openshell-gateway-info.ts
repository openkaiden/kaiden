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

import z from 'zod';

export const GatewayHealthSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);

export type GatewayHealth = z.output<typeof GatewayHealthSchema>;

export const GatewayStateSchema = z.object({
  reachable: z.boolean(),
  health: GatewayHealthSchema,
});

export type GatewayState = z.output<typeof GatewayStateSchema>;

export type LocalGatewayDriver = 'vm' | 'podman' | 'docker';

export const KAIDEN_LOCAL_GATEWAY_NAME = 'kaiden-local';

export const GatewayInfoSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  active: z.boolean().optional(),
  auth: z.string().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  is_remote: z.boolean().optional(),
  remote_host: z.string().nullable().optional(),
  resolved_host: z.string().nullable().optional(),
  gatewayState: GatewayStateSchema.optional(),
  driver: z.enum(['vm', 'podman', 'docker']).optional(),
});

export type GatewayInfo = z.output<typeof GatewayInfoSchema>;

export const SandboxInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.enum(['Provisioning', 'Ready', 'Error', 'Deleting', 'Unknown', 'Unspecified']),
  created_at: z
    .string()
    .transform(ts => {
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(ts) && !/Z$/i.test(ts) && !/[+-]\d{2}:?\d{2}$/.test(ts)) {
        return `${ts.replace(' ', 'T')}Z`;
      }
      return ts;
    })
    .optional(),
  current_policy_version: z.number().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  resource_version: z.number().optional(),
});

export type SandboxInfo = z.output<typeof SandboxInfoSchema> & {
  sourcePath?: string;
};

export const WORKSPACE_LABEL = 'ai.openkaiden.kaiden.workspace';
export const AGENT_LABEL = 'ai.openkaiden.kaiden.agent';

export function decodeWorkspaceLabels(labels: Record<string, string>): string | undefined {
  let encoded: string;
  if (WORKSPACE_LABEL in labels) {
    encoded = labels[WORKSPACE_LABEL]!;
  } else {
    const chunks = Object.entries(labels)
      .flatMap(([key, value]) => {
        if (!key.startsWith(`${WORKSPACE_LABEL}.`)) {
          return [];
        }
        const suffix = key.slice(WORKSPACE_LABEL.length + 1);
        if (!/^\d+$/.test(suffix)) {
          return [];
        }
        return [{ index: Number(suffix), value }];
      })
      .sort((a, b) => a.index - b.index);
    if (chunks.length === 0 || chunks.some((chunk, i) => chunk.index !== i)) {
      return undefined;
    }
    encoded = chunks.map(chunk => chunk.value).join('');
  }
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export interface CreateSandboxOptions {
  name?: string;
  gateway?: string;
  from?: string;
  gpu?: boolean;
  gpuDevice?: string;
  cpu?: string;
  memory?: string;
  providers?: string[];
  env?: Record<string, string>;
  labels?: Record<string, string>;
  uploads?: Array<{ local: string; remote: string }>;
  driverConfig?: Record<string, unknown>;
  command?: string[];
  noTty?: boolean;
  tty?: boolean;
  detach?: boolean;
  policy?: string;
}

export interface GatewayAddOptions {
  endpoint: string;
  name?: string;
  /** SSH destination for remote mTLS gateway (conflicts with `local`). */
  remote?: string;
  /** Use local mTLS gateway in Docker (conflicts with `remote`). */
  local?: boolean;
}

export interface OpenshellGatewayStartOptions {
  port?: number;
  bindAddress?: string;
  disableTls?: boolean;
  /** Skip CLI registration when restarting an already-registered gateway. */
  skipRegistration?: boolean;
  /** Override the supervisor container image. When unset, the image tag is pinned to the gateway binary version. */
  supervisorImage?: string;
}

export interface CreateLocalGatewayOptions {
  name: string;
  bindAddress: string;
  port: number;
  /** Overrides the driver inferred from the active gateway. */
  driver?: LocalGatewayDriver;
}

export const GATEWAY_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const GatewayRuntimeInfoSchema = z.looseObject({
  status: GatewayHealthSchema,
  compute_drivers: z.array(
    z.looseObject({
      capabilities: z.looseObject({
        driver_name: z.string(),
      }),
      name: z.string(),
    }),
  ),
});

export type GatewayRuntimeInfo = z.output<typeof GatewayRuntimeInfoSchema>;

export interface GatewaySandboxes {
  gateway: GatewayInfo;
  sandboxes: SandboxInfo[];
}

export const OpenshellProviderInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
});

export type OpenshellProviderInfo = z.output<typeof OpenshellProviderInfoSchema>;

export const OpenshellProfileCredentialSchema = z.looseObject({
  name: z.string(),
  required: z.boolean(),
  description: z.string().optional(),
  env_vars: z.array(z.string()).optional(),
});

export type OpenshellProfileCredential = z.output<typeof OpenshellProfileCredentialSchema>;

export const OpenshellProfileSchema = z.looseObject({
  id: z.string(),
  display_name: z.string(),
  description: z.string().optional(),
  credentials: z.array(OpenshellProfileCredentialSchema).optional(),
});

export type OpenshellProfile = z.output<typeof OpenshellProfileSchema>;

export interface CreateProviderOptions {
  name: string;
  type: string;
  credentials: Record<string, string>;
  config?: Record<string, string>;
  flags?: string[];
  env?: Record<string, string>;
}

export interface SetInferenceOptions {
  provider: string;
  model: string;
}
