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

import type { components as configComponents } from '@openkaiden/workspace-configuration';

/**
 * Minimal workspace summary.
 * Previously mapped to the full `Workspace` schema from `@openkaiden/kdn-api`,
 * but actual usage is exclusively `Pick<AgentWorkspaceSummary, 'name'>`.
 */
export interface AgentWorkspaceSummary {
  name: string;
}

/**
 * Returned by mutating workspace commands (e.g. remove, init) to confirm
 * which workspace was affected.
 */
export interface AgentWorkspaceId {
  id: string;
}

/**
 * The schema for a workspace's YAML configuration file
 * Matches the contract in @openkaiden/workspace-configuration.
 */
export type AgentWorkspaceConfiguration = configComponents['schemas']['WorkspaceConfiguration'];

/**
 * The schema for a workspace's network configuration
 * Matches the contract in @openkaiden/workspace-configuration.
 */
export type NetworkConfiguration = configComponents['schemas']['NetworkConfiguration'];

export type AgentWorkspaceMcpRemoteServer = configComponents['schemas']['McpServer'];

export type AgentWorkspaceMcpCommandServer = configComponents['schemas']['McpCommand'];

export type AgentWorkspaceMcpConfig = configComponents['schemas']['McpConfiguration'];

export type AgentWorkspaceMount = configComponents['schemas']['Mount'];

/** Maximum sandbox name length for OpenShell. */
export const SANDBOX_NAME_MAX_LENGTH = 19;

/**
 * Sanitize a display name into a DNS-1123 label.
 * Lowercases, replaces invalid characters with hyphens, collapses consecutive
 * hyphens, strips leading/trailing hyphens, and truncates to the maximum length.
 */
export function sanitizeDns1123Label(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '')
    .slice(0, SANDBOX_NAME_MAX_LENGTH);
}

export function getSandboxNameValidationError(name: string): string | undefined {
  if (name.length === 0) {
    return 'Workspace name must not be empty';
  }
  if (name.length > SANDBOX_NAME_MAX_LENGTH) {
    return `Workspace name must not exceed ${SANDBOX_NAME_MAX_LENGTH} characters`;
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'Workspace name must contain only lowercase letters (a-z), digits (0-9), and hyphens (-)';
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return 'Workspace name must not start or end with a hyphen';
  }
  if (name.includes('--')) {
    return 'Workspace name must not contain consecutive hyphens (--)';
  }
  return undefined;
}

/**
 * Options for creating (initializing) a new workspace via `kdn init`.
 */
export interface AgentWorkspaceCreateOptions {
  sourcePath?: string;
  agent: string;
  image?: string;
  model: string;
  gateway: string;
  name?: string;
  description?: string;
  project?: string;
  skills?: string[];
  network?: NetworkConfiguration;
  secrets?: string[];
  mcp?: AgentWorkspaceMcpConfig;
  workspaceConfiguration?: AgentWorkspaceConfiguration;
  mounts?: AgentWorkspaceMount[];
  replaceConfig?: boolean;
  /** OCI images of the addons to add to the workspace. The agent addon image is always included. */
  addonImages?: string[];
}
