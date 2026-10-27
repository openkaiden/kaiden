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
export const CODEX_AUTH_PATH = '.codex/auth.json';

// Codex's built-in `openai` provider ignores OPENAI_API_KEY from the environment,
// so a custom provider with `env_key` is needed for the key injected by the sandbox to be sent.
const CODEX_MODEL_PROVIDER_ID = 'kaiden';
const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const WORKSPACE_SOURCES_PATH = '/sandbox';

const McpServerEntrySchema = z.looseObject({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  http_headers: z.record(z.string(), z.string()).optional(),
});

const ModelProviderEntrySchema = z.looseObject({
  name: z.string().optional(),
  base_url: z.string().optional(),
  env_key: z.string().optional(),
  wire_api: z.string().optional(),
});

const ProjectEntrySchema = z.looseObject({
  trust_level: z.string().optional(),
});

const CodexConfigSchema = z.looseObject({
  model: z.string().optional(),
  model_provider: z.string().optional(),
  model_providers: z.record(z.string(), ModelProviderEntrySchema).optional(),
  mcp_servers: z.record(z.string(), McpServerEntrySchema).optional(),
  projects: z.record(z.string(), ProjectEntrySchema).optional(),
});

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
    baseImage:
      'ghcr.io/openkaiden/openshell-image-codex@sha256:fe6c5d1015ad4b4f838e2818b692044e828cd345c2542899ad0fada153363dd9',
    configurationFiles: [
      {
        path: CODEX_CONFIG_PATH,
        async read(): Promise<string> {
          return '';
        },
      },
      {
        path: CODEX_AUTH_PATH,
        async read(): Promise<string> {
          return JSON.stringify({ auth_mode: 'apikey' });
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

      config.model_provider = CODEX_MODEL_PROVIDER_ID;
      config.model_providers = {
        ...config.model_providers,
        [CODEX_MODEL_PROVIDER_ID]: {
          name: CODEX_MODEL_PROVIDER_ID,
          base_url: context.model.endpoint ?? DEFAULT_OPENAI_BASE_URL,
          env_key: OPENAI_API_KEY_ENV,
          wire_api: 'responses',
        },
      };

      const projects = config.projects ?? {};
      projects[WORKSPACE_SOURCES_PATH] = { ...projects[WORKSPACE_SOURCES_PATH], trust_level: 'trusted' };
      config.projects = projects;

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
