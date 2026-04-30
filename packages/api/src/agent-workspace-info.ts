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

import type { components as cliComponents } from '@openkaiden/kdn-api';
import type { components as configComponents } from '@openkaiden/workspace-configuration';

/**
 * Workspace data from the `kdn workspace list` command.
 * Matches the CLI contract exactly — fields will be added here
 * as the CLI evolves and publishes them in @openkaiden/kdn-api.
 */
export type AgentWorkspaceSummary = cliComponents['schemas']['Workspace'];

/**
 * Returned by mutating workspace commands (e.g. remove, init) to confirm
 * which workspace was affected. Maps to the CLI `WorkspaceId` schema.
 */
export type AgentWorkspaceId = cliComponents['schemas']['WorkspaceId'];

/**
 * The schema for a workspace's YAML configuration file
 * Matches the contract in @openkaiden/workspace-configuration.
 */
export type AgentWorkspaceConfiguration = configComponents['schemas']['WorkspaceConfiguration'];

/**
 * CLI environment info returned by `kdn info --output json`.
 * Contains the CLI version, supported agents, and available runtimes.
 */
export type CliInfo = cliComponents['schemas']['Info'];

/**
 * Options for creating (initializing) a new workspace via `kdn init`.
 */
export interface AgentWorkspaceCreateOptions {
  sourcePath: string;
  agent: string;
  model?: string;
  runtime?: string;
  name?: string;
  project?: string;
}
