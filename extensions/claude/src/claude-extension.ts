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

import type { AgentWorkspaceContext, Disposable, ExtensionContext } from '@openkaiden/api';
import { agents, provider } from '@openkaiden/api';
import type { Container } from 'inversify';
import { z } from 'zod';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { ClaudeInferenceManager } from '/@/manager/claude-inference-manager';
import { ClaudeSkillsManager } from '/@/manager/claude-skills-manager';

export const PROVIDER_ID = 'claude';
export const CLAUDE_SETTINGS_PATH = '.claude/settings.json';
export const CLAUDE_JSON_PATH = '.claude.json';
const WORKSPACE_SOURCES_PATH = '/sandbox';

/**
 * One-time setup command executed inside the sandbox after creation via
 * `openshell sandbox exec`.  It reads the ANTHROPIC_API_KEY environment
 * variable (resolved at runtime by the openshell provider system) and
 * writes its last-20-character suffix into ~/.claude.json so Claude Code
 * does not prompt the user for API key confirmation.
 */
const SETUP_COMMAND = `\
if [ -n "\${ANTHROPIC_API_KEY:-}" ]; then
  CLAUDE_JSON="$HOME/.claude.json"
  [ -f "$CLAUDE_JSON" ] || echo "{}" > "$CLAUDE_JSON"
  CLAUDE_JSON="$CLAUDE_JSON" node -e '
    const fs = require("fs");
    const p = process.env.CLAUDE_JSON;
    try {
      const config = JSON.parse(fs.readFileSync(p, "utf8"));
      const suffix = process.env.ANTHROPIC_API_KEY.slice(-20);
      config.customApiKeyResponses = config.customApiKeyResponses || {};
      const approved = new Set(config.customApiKeyResponses.approved || []);
      approved.add(suffix);
      config.customApiKeyResponses.approved = [...approved];
      config.customApiKeyResponses.rejected =
        (config.customApiKeyResponses.rejected || []).filter(r => r !== suffix);
      fs.writeFileSync(p, JSON.stringify(config, null, 2));
    } catch {}
  ' 2>/dev/null || true
fi`;

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
          message: err instanceof Error ? err.message : String(err),
        });
        return z.NEVER;
      }
    },
    encode: value => JSON.stringify(value, undefined, 2),
  });
}

const ClaudeSettingsCodec = jsonCodec(
  z.looseObject({
    model: z.string().optional(),
  }),
);

const ClaudeProjectSchema = z.looseObject({
  hasTrustDialogAccepted: z.boolean().optional(),
});

const ClaudeCustomApiKeyResponsesSchema = z.looseObject({
  approved: z.array(z.string()).optional(),
  rejected: z.array(z.string()).optional(),
});

const ClaudeJsonCodec = jsonCodec(
  z.looseObject({
    hasCompletedOnboarding: z.boolean().optional(),
    projects: z.record(z.string(), ClaudeProjectSchema).optional(),
    mcpServers: z.record(z.string(), z.unknown()).optional(),
    customApiKeyResponses: ClaudeCustomApiKeyResponsesSchema.optional(),
  }),
);

export class ClaudeExtension {
  #extensionContext: ExtensionContext;

  #inversifyBinding: InversifyBinding | undefined;
  #container: Container | undefined;
  #claudeSkillsManager: ClaudeSkillsManager | undefined;
  #claudeInferenceManager: ClaudeInferenceManager | undefined;
  #agentDisposable: Disposable | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const providerImages = {
      icon: './icon.png',
      logo: {
        dark: './icon.png',
        light: './icon.png',
      },
    };

    const claudeProvider = provider.createProvider({
      name: 'Claude',
      status: 'unknown',
      id: PROVIDER_ID,
      images: providerImages,
    });

    this.#agentDisposable = agents.registerAgent({
      id: 'claude',
      name: 'Claude Code',
      description: 'Anthropic cloud agent — connect with an API key to access Claude models.',
      icon: providerImages,
      command: 'claude',
      baseImage: 'ghcr.io/openkaiden/openshell-image-claude:fd194d5bde14bf758c82bb2aace23fea596dfbde',
      acp: { command: 'claude-agent-acp', args: [] },
      tags: ['Cloud'],
      setupCommand: SETUP_COMMAND,
      configurationFiles: [
        {
          path: CLAUDE_SETTINGS_PATH,
          async read(): Promise<string> {
            return '{}';
          },
        },
        {
          path: CLAUDE_JSON_PATH,
          async read(): Promise<string> {
            return '{}';
          },
        },
      ],
      destinationSkillsFolder: '${HOME}/.claude/skills',
      isSupportedModelType: (type): boolean => type.name === 'anthropic' || type.name === 'vertexai',
      async preWorkspaceStart(context: AgentWorkspaceContext): Promise<void> {
        // Handle Vertex AI model configuration
        if (context.model.llmMetadata?.name === 'vertexai') {
          // Add Claude Code-specific environment variables for Vertex AI
          const claudeEnvVars = [
            { name: 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', value: '1' },
            { name: 'ANTHROPIC_BASE_URL', value: 'https://inference.local' },
            { name: 'ANTHROPIC_API_KEY', value: 'unused' },
          ];

          context.workspace.environment ??= [];
          for (const envVar of claudeEnvVars) {
            // Remove existing entry if present
            const index = context.workspace.environment.findIndex(e => e.name === envVar.name);
            if (index >= 0) {
              context.workspace.environment.splice(index, 1);
            }
            context.workspace.environment.push(envVar);
          }

          // CLAUDE_CODE_SIMPLE prevents Claude Code from indexing user-installed skills.
          context.workspace.environment = context.workspace.environment.filter(e => e.name !== 'CLAUDE_CODE_SIMPLE');
        }

        const settingsFile = context.configurationFiles.find(f => f.path === CLAUDE_SETTINGS_PATH);
        if (settingsFile) {
          const config = ClaudeSettingsCodec.decode(await settingsFile.read());
          config.model = context.model.model.label;
          await settingsFile.update(ClaudeSettingsCodec.encode(config));
        }

        const claudeJsonFile = context.configurationFiles.find(f => f.path === CLAUDE_JSON_PATH);
        if (claudeJsonFile) {
          const config = ClaudeJsonCodec.decode(await claudeJsonFile.read());
          config.hasCompletedOnboarding = true;

          const projects = config.projects ?? {};
          const project = projects[WORKSPACE_SOURCES_PATH] ?? {};
          project.hasTrustDialogAccepted = true;
          projects[WORKSPACE_SOURCES_PATH] = project;
          config.projects = projects;

          // customApiKeyResponses.approved is written by setupCommand at sandbox
          // runtime, where the real ANTHROPIC_API_KEY value is available.

          const mcpServers = context.workspace.mcp?.servers;
          const mcpCommands = context.workspace.mcp?.commands;

          if (mcpServers?.length || mcpCommands?.length) {
            const servers: Record<string, unknown> = config.mcpServers ?? {};

            for (const cmd of mcpCommands ?? []) {
              servers[cmd.name] = {
                type: 'stdio',
                command: cmd.command,
                args: cmd.args ?? [],
                env: cmd.env ?? {},
              };
            }

            for (const srv of mcpServers ?? []) {
              const entry: Record<string, unknown> = { type: 'sse', url: srv.url };
              if (srv.headers && Object.keys(srv.headers).length > 0) {
                entry['headers'] = srv.headers;
              }
              servers[srv.name] = entry;
            }

            config.mcpServers = servers;
          }

          await claudeJsonFile.update(ClaudeJsonCodec.encode(config));
        }
      },
    });

    this.#inversifyBinding = new InversifyBinding(claudeProvider, this.#extensionContext);
    this.#container = await this.#inversifyBinding.initBindings();

    try {
      this.#claudeSkillsManager = await this.getContainer()?.getAsync(ClaudeSkillsManager);
    } catch (e) {
      console.error('Error while creating the Claude skills manager', e);
      throw e;
    }

    try {
      this.#claudeInferenceManager = await this.getContainer()?.getAsync(ClaudeInferenceManager);
    } catch (e) {
      console.error('Error while creating the Claude inference manager', e);
      throw e;
    }

    await this.#claudeSkillsManager?.init();
    await this.#claudeInferenceManager?.init();
  }

  protected getContainer(): Container | undefined {
    return this.#container;
  }

  async deactivate(): Promise<void> {
    this.#agentDisposable?.dispose();
    this.#agentDisposable = undefined;
    await this.#inversifyBinding?.dispose();
    this.#claudeSkillsManager?.dispose();
    this.#claudeSkillsManager = undefined;
    this.#claudeInferenceManager?.dispose();
    this.#claudeInferenceManager = undefined;
  }
}
