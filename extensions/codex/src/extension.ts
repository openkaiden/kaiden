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

import type { AgentWorkspaceContext, ExtensionContext } from '@openkaiden/api';
import { agents } from '@openkaiden/api';
import { parse, stringify } from 'smol-toml';
import { z } from 'zod';

export const CODEX_CONFIG_PATH = '.codex/config.toml';

const McpServerEntrySchema = z.looseObject({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});

const CodexConfigSchema = z.looseObject({
  model: z.string().optional(),
  model_provider: z.string().optional(),
  model_providers: z.record(z.string(), z.looseObject({})).optional(),
  projects: z.record(z.string(), z.looseObject({ trust_level: z.string().optional() })).optional(),
  mcp_servers: z.record(z.string(), McpServerEntrySchema).optional(),
});

const OPENSHELL_PROVIDER = 'openshell';
const OPENAI_API_KEY = 'OPENAI_API_KEY';
const WORKSPACE_PATH = '/sandbox';

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  const disposable = agents.registerAgent({
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex — a cloud-based coding agent that runs in a sandboxed environment with OpenAI models.',
    icon: {
      icon: './icon.png',
      logo: { dark: './icon.png', light: './icon.png' },
    },
    command: 'codex',
    configurationFiles: [
      {
        path: CODEX_CONFIG_PATH,
        async read(): Promise<string> {
          return '';
        },
      },
    ],
    destinationSkillsFolder: '${HOME}/.agents/skills',
    isSupportedModelType(type): boolean {
      return type.name === 'openai';
    },
    async preWorkspaceStart(context: AgentWorkspaceContext): Promise<void> {
      const configFile = context.configurationFiles.find(f => f.path === CODEX_CONFIG_PATH);
      if (!configFile) {
        return;
      }

      const raw = await configFile.read();
      const config = CodexConfigSchema.parse(raw ? parse(raw) : {});

      config.model = context.model.model.label;
      config.model_provider = OPENSHELL_PROVIDER;
      config.model_providers ??= {};
      config.model_providers[OPENSHELL_PROVIDER] = {
        name: 'OpenShell',
        base_url: 'https://inference.local/v1',
        env_key: OPENAI_API_KEY,
        wire_api: 'responses',
        supports_websockets: false,
      };
      config.projects ??= {};
      config.projects[WORKSPACE_PATH] = {
        ...config.projects[WORKSPACE_PATH],
        trust_level: 'trusted',
      };

      context.workspace.environment ??= [];
      const apiKeyIndex = context.workspace.environment.findIndex(entry => entry.name === OPENAI_API_KEY);
      if (apiKeyIndex >= 0) {
        context.workspace.environment.splice(apiKeyIndex, 1);
      }
      context.workspace.environment.push({ name: OPENAI_API_KEY, value: 'unused' });

      const mcpServers = context.workspace.mcp?.servers;
      const mcpCommands = context.workspace.mcp?.commands;

      if (mcpServers?.length || mcpCommands?.length) {
        const servers = config.mcp_servers ?? {};

        for (const cmd of mcpCommands ?? []) {
          const entry: Record<string, unknown> = {
            command: cmd.command,
            args: cmd.args ?? [],
          };
          if (cmd.env && Object.keys(cmd.env).length > 0) {
            entry['env'] = cmd.env;
          }
          servers[cmd.name] = entry;
        }

        for (const srv of mcpServers ?? []) {
          const entry: Record<string, unknown> = { url: srv.url };
          if (srv.headers && Object.keys(srv.headers).length > 0) {
            entry['http_headers'] = srv.headers;
          }
          servers[srv.name] = entry;
        }

        config.mcp_servers = servers;
      }

      await configFile.update(stringify(config));
    },
  });
  extensionContext.subscriptions.push(disposable);
}

export function deactivate(): void {}
