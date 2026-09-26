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

import type { AgentWorkspaceContext, ExtensionContext, ProviderProfile } from '@openkaiden/api';
import { agents, openshell } from '@openkaiden/api';
import { load } from 'js-yaml';
import { z } from 'zod';

import copilotProfileYaml from './copilot.yaml?raw';

function jsonCodec<T extends z.ZodType>(schema: T): z.ZodCodec<z.ZodString, T> {
  return z.codec(z.string(), schema, {
    decode: (jsonString, ctx) => {
      try {
        return JSON.parse(jsonString);
      } catch (err: unknown) {
        ctx.issues.push({
          code: 'invalid_format',
          format: 'json',
          input: jsonString,
          message: err instanceof Error ? err.message : 'Invalid JSON',
        });
        return z.NEVER;
      }
    },
    encode: value => JSON.stringify(value, undefined, 2),
  });
}

const CopilotSettingsCodec = jsonCodec(
  z.looseObject({
    model: z.string().optional(),
  }),
);

const CopilotMcpConfigCodec = jsonCodec(
  z.looseObject({
    mcpServers: z.record(z.string(), z.unknown()).optional(),
  }),
);

export const COPILOT_SETTINGS_PATH = '.copilot/settings.json';
export const COPILOT_MCP_CONFIG_PATH = '.copilot/mcp-config.json';

// Maps Kaiden llmMetadata.name values to Copilot CLI COPILOT_PROVIDER_TYPE.
// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models
const COPILOT_PROVIDER_TYPE: Record<string, string> = {
  openai: 'openai',
  ollama: 'openai',
  anthropic: 'anthropic',
};

// Providers that do NOT require an API key (local-only, no auth).
const NO_API_KEY_PROVIDERS = new Set(['ollama']);

// Maps Kaiden provider names to the env var that the OpenShell vault injects
// for that provider's API key.  Used to bridge the vault-injected name to the
// COPILOT_PROVIDER_API_KEY that the Copilot CLI expects.
const VAULT_API_KEY_ENV_VAR: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'OPENAI_API_KEY',
};

// Default base URLs for providers that omit `endpoint` from their connection
// info when using the standard API endpoint (e.g. Anthropic cloud).
const DEFAULT_PROVIDER_BASE_URL: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
};

function setEnvVar(context: AgentWorkspaceContext, name: string, value: string): void {
  context.workspace.environment ??= [];
  const index = context.workspace.environment.findIndex(e => e.name === name);
  if (index >= 0) {
    context.workspace.environment.splice(index, 1);
  }
  context.workspace.environment.push({ name, value });
}

// Builds the shell command that bridges vault-injected API key env vars to
// COPILOT_PROVIDER_API_KEY before launching the Copilot CLI.  The bridge only
// activates when COPILOT_PROVIDER_BASE_URL is set (BYOK mode); without it
// Copilot uses GitHub auth and rejects a stray COPILOT_PROVIDER_API_KEY.
export function buildCopilotCommand(): string {
  const fallbacks = Array.from(new Set(Object.values(VAULT_API_KEY_ENV_VAR)));
  const inner = fallbacks.reduceRight((acc, v) => `\${${v}:-${acc}}`, '');
  const bridge = `export COPILOT_PROVIDER_API_KEY="\${COPILOT_PROVIDER_API_KEY:-${inner}}"`;
  return `[ -n "$COPILOT_PROVIDER_BASE_URL" ] && ${bridge}; copilot`;
}

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  const disposable = agents.registerAgent({
    id: 'copilot',
    name: 'GitHub Copilot',
    // blurb extracted from https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
    description:
      'GitHub Copilot CLI gives you quick access to a powerful AI agent, without having to leave your terminal.',
    icon: {
      icon: {
        light: './icon_light.png',
        dark: './icon_dark.png',
      },
      logo: {
        dark: './icon_dark.png',
        light: './icon_light.png',
      },
    },
    command: buildCopilotCommand(),
    acp: { args: ['--acp'] },
    tags: [],
    destinationSkillsFolder: '${HOME}/.copilot/skills',
    configurationFiles: [
      {
        path: COPILOT_SETTINGS_PATH,
        async read(): Promise<string> {
          return '{}';
        },
      },
      {
        path: COPILOT_MCP_CONFIG_PATH,
        async read(): Promise<string> {
          return '{"mcpServers":{}}';
        },
      },
    ],
    isSupportedModelType(type): boolean {
      return type.name !== 'vertexai';
    },
    async preWorkspaceStart(context: AgentWorkspaceContext): Promise<void> {
      const providerName = context.model.llmMetadata?.name;
      const modelLabel = context.model.model.label;
      const endpoint = context.model.endpoint;

      // Write model into settings.json (lowest precedence, acts as fallback).
      const configFile = context.configurationFiles.find(f => f.path === COPILOT_SETTINGS_PATH);
      if (configFile) {
        const config = CopilotSettingsCodec.decode(await configFile.read());
        config.model = modelLabel;
        await configFile.update(CopilotSettingsCodec.encode(config));
      }

      // For non-GitHub providers, configure BYOK environment variables so the
      // Copilot CLI talks to the correct inference endpoint.
      // https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models
      const baseUrl = endpoint ?? (providerName ? DEFAULT_PROVIDER_BASE_URL[providerName] : undefined);
      if (providerName && baseUrl) {
        const copilotType = COPILOT_PROVIDER_TYPE[providerName];
        if (copilotType) {
          setEnvVar(context, 'COPILOT_PROVIDER_TYPE', copilotType);
        }

        setEnvVar(context, 'COPILOT_PROVIDER_BASE_URL', baseUrl);
        setEnvVar(context, 'COPILOT_MODEL', modelLabel);

        if (NO_API_KEY_PROVIDERS.has(providerName)) {
          setEnvVar(context, 'COPILOT_PROVIDER_API_KEY', '');
        }
      }

      // Write MCP server configuration into mcp-config.json.
      // https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
      const mcpServers = context.workspace.mcp?.servers;
      const mcpCommands = context.workspace.mcp?.commands;

      if (mcpServers?.length || mcpCommands?.length) {
        const mcpConfigFile = context.configurationFiles.find(f => f.path === COPILOT_MCP_CONFIG_PATH);
        if (mcpConfigFile) {
          const mcpConfig = CopilotMcpConfigCodec.decode(await mcpConfigFile.read());
          const servers: Record<string, unknown> = mcpConfig.mcpServers ?? {};

          for (const srv of mcpServers ?? []) {
            const entry: Record<string, unknown> = { type: 'http', url: srv.url };
            if (srv.headers && Object.keys(srv.headers).length > 0) {
              entry['headers'] = srv.headers;
            }
            servers[srv.name] = entry;
          }

          for (const cmd of mcpCommands ?? []) {
            const entry: Record<string, unknown> = { type: 'local', command: cmd.command, args: cmd.args ?? [] };
            if (cmd.env && Object.keys(cmd.env).length > 0) {
              entry['env'] = cmd.env;
            }
            servers[cmd.name] = entry;
          }

          mcpConfig.mcpServers = servers;
          await mcpConfigFile.update(CopilotMcpConfigCodec.encode(mcpConfig));
        }
      }
    },
  });
  extensionContext.subscriptions.push(disposable);

  const profile = load(copilotProfileYaml) as ProviderProfile;
  if (!openshell.getProfiles().some(p => p.id === profile.id)) {
    extensionContext.subscriptions.push(openshell.registerProfile(profile));
  }
}

export function deactivate(): void {}
