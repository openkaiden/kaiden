/**********************************************************************
 * Copyright (C) 2025-2026 Red Hat, Inc.
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

import type { AgentWorkspaceContext, ExtensionContext, ModelType } from '@openkaiden/api';
import { agents } from '@openkaiden/api';
import { dump, load } from 'js-yaml';
import { z } from 'zod';

export const GOOSE_CONFIG_PATH = '.config/goose/config.yaml';

const GOOSE_PROVIDER_MAPPING: Record<string, string> = {
  gemini: 'openai',
};

const GooseExtensionEntrySchema = z.looseObject({
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  cmd: z.string().optional(),
  args: z.array(z.string()).optional(),
  envs: z.record(z.string(), z.string()).optional(),
  uri: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
});

const GooseConfigSchema = z.looseObject({
  extensions: z.record(z.string(), GooseExtensionEntrySchema).optional(),
});

const GooseConfigCodec = z.codec(z.string(), GooseConfigSchema, {
  decode: (yamlString, ctx) => {
    if (!yamlString.trim()) {
      return {};
    }
    try {
      return (load(yamlString) as Record<string, unknown>) ?? {};
    } catch (err: unknown) {
      ctx.issues.push({
        code: 'invalid_format',
        format: 'yaml',
        input: yamlString,
        message: err instanceof Error ? err.message : String(err),
      });
      return z.NEVER;
    }
  },
  encode: value => dump(value),
});

function nonEmpty(obj: Record<string, string> | undefined): Record<string, string> | undefined {
  return obj && Object.keys(obj).length > 0 ? obj : undefined;
}

function toOllamaHost(endpoint: string): string {
  return endpoint.replace(/\/v1\/?$/, '');
}

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  const disposable = agents.registerAgent({
    id: 'goose',
    name: 'Goose',
    description: 'Open-source autonomous coding agent by Block.',
    baseImage:
      'ghcr.io/openkaiden/openshell-image-goose@sha256:25806faabdac9da5b929bf97201a47f55a5917ccebb82bb59efc25c36340260c',
    icon: {
      icon: { dark: './icon_dark.png', light: './icon_light.png' },
      logo: { dark: './icon_dark.png', light: './icon_light.png' },
    },
    tags: ['Local'],
    command: 'goose',
    acp: { args: ['acp'] },
    configurationFiles: [
      {
        path: GOOSE_CONFIG_PATH,
        async read(): Promise<string> {
          return '';
        },
      },
    ],
    destinationSkillsFolder: '${HOME}/.agents/skills',
    isSupportedModelType(type: ModelType): boolean {
      return type.name !== 'vertexai';
    },
    async preWorkspaceStart(context: AgentWorkspaceContext): Promise<void> {
      const provider = context.model.llmMetadata?.name;

      const configFile = context.configurationFiles.find(f => f.path === GOOSE_CONFIG_PATH);
      if (!configFile) {
        return;
      }

      const decodedConfig = GooseConfigCodec.safeDecode(await configFile.read());
      const config = decodedConfig.success ? decodedConfig.data : {};
      config.GOOSE_MODEL = context.model.model.label;
      config.GOOSE_TELEMETRY_ENABLED = false;

      if (provider) {
        config.GOOSE_PROVIDER = GOOSE_PROVIDER_MAPPING[provider] ?? provider;
      }

      const endpoint = context.model.endpoint;
      if (endpoint) {
        if (provider === 'ollama') {
          config.OLLAMA_HOST = toOllamaHost(endpoint);
          delete config.OPENAI_BASE_URL;
        } else {
          config.OPENAI_BASE_URL = endpoint;
        }
      }

      const mcpServers = context.workspace.mcp?.servers;
      const mcpCommands = context.workspace.mcp?.commands;

      if (mcpServers?.length || mcpCommands?.length) {
        config.extensions ??= {};

        for (const server of mcpServers ?? []) {
          config.extensions[server.name] = {
            name: server.name,
            type: 'streamable_http',
            uri: server.url,
            enabled: true,
            headers: nonEmpty(server.headers),
          };
        }

        for (const cmd of mcpCommands ?? []) {
          config.extensions[cmd.name] = {
            name: cmd.name,
            type: 'stdio',
            cmd: cmd.command,
            args: cmd.args ?? [],
            enabled: true,
            envs: nonEmpty(cmd.env),
          };
        }
      }

      await configFile.update(GooseConfigCodec.encode(config));
    },
  });
  extensionContext.subscriptions.push(disposable);
}

export function deactivate(): void {}
