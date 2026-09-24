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

import type {
  Agent,
  AgentConfigurationFile,
  AgentWorkspaceContext,
  Disposable,
  ExtensionContext,
  LLMMetadata,
} from '@openkaiden/api';
import { agents, openshell } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { activate, buildCopilotCommand, COPILOT_MCP_CONFIG_PATH, COPILOT_SETTINGS_PATH } from './extension';

vi.mock('./copilot.yaml?raw', () => ({ default: 'id: copilot\ndisplay_name: GitHub Copilot\n' }));

const AGENT_DISPOSABLE_MOCK: Disposable = { dispose: vi.fn() };

let extensionContextMock: ExtensionContext;

beforeEach(() => {
  vi.resetAllMocks();

  extensionContextMock = {
    subscriptions: [],
  } as unknown as ExtensionContext;

  vi.mocked(agents.registerAgent).mockReturnValue(AGENT_DISPOSABLE_MOCK);
  vi.mocked(openshell.getProfiles).mockReturnValue([]);
});

function getRegisteredAgent(): Agent {
  return vi.mocked(agents.registerAgent).mock.calls[0]![0];
}

interface McpServer {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

interface McpCommand {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function createContext(
  configFiles: AgentConfigurationFile[],
  options?: {
    modelLabel?: string;
    llmMetadata?: LLMMetadata;
    endpoint?: string;
    mcp?: { servers?: McpServer[]; commands?: McpCommand[] };
  },
): AgentWorkspaceContext {
  return {
    model: {
      llmMetadata: options?.llmMetadata,
      model: { label: options?.modelLabel ?? 'gpt-4o' },
      endpoint: options?.endpoint,
    },
    configurationFiles: configFiles,
    workspace: { mcp: options?.mcp },
  };
}

function createConfigFile(content = '{}'): AgentConfigurationFile & { updateMock: ReturnType<typeof vi.fn> } {
  const updateMock = vi.fn();
  const file: AgentConfigurationFile = {
    path: COPILOT_SETTINGS_PATH,
    read: vi.fn().mockResolvedValue(content),
    update: updateMock,
  };
  return Object.assign(file, { updateMock });
}

function createMcpConfigFile(
  content = '{"mcpServers":{}}',
): AgentConfigurationFile & { updateMock: ReturnType<typeof vi.fn> } {
  const updateMock = vi.fn();
  const file: AgentConfigurationFile = {
    path: COPILOT_MCP_CONFIG_PATH,
    read: vi.fn().mockResolvedValue(content),
    update: updateMock,
  };
  return Object.assign(file, { updateMock });
}

describe('buildCopilotCommand', () => {
  test('returns shell command that bridges vault API key env vars to COPILOT_PROVIDER_API_KEY', () => {
    const cmd = buildCopilotCommand();

    expect(cmd).toContain('COPILOT_PROVIDER_API_KEY=');
    expect(cmd).toContain('OPENAI_API_KEY');
    expect(cmd).toContain('ANTHROPIC_API_KEY');
    expect(cmd).toMatch(/copilot$/);
  });

  test('only bridges API key when COPILOT_PROVIDER_BASE_URL is set (BYOK mode)', () => {
    const cmd = buildCopilotCommand();

    expect(cmd).toContain('$COPILOT_PROVIDER_BASE_URL');
  });

  test('preserves existing COPILOT_PROVIDER_API_KEY when set', () => {
    const cmd = buildCopilotCommand();

    expect(cmd).toContain('${COPILOT_PROVIDER_API_KEY:-');
  });
});

describe('activate', () => {
  test('registers copilot agent', async () => {
    await activate(extensionContextMock);

    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'copilot',
        name: 'GitHub Copilot',
        description: expect.any(String),
        icon: expect.objectContaining({ icon: { light: './icon_light.png', dark: './icon_dark.png' } }),
        command: buildCopilotCommand(),
        destinationSkillsFolder: '${HOME}/.copilot/skills',
        isSupportedModelType: expect.any(Function),
      }),
    );
  });

  test('pushes agent disposable to subscriptions', async () => {
    await activate(extensionContextMock);

    expect(extensionContextMock.subscriptions).toContain(AGENT_DISPOSABLE_MOCK);
  });

  test('registers openshell profile', async () => {
    await activate(extensionContextMock);

    expect(openshell.registerProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'copilot',
        display_name: 'GitHub Copilot',
      }),
    );
  });

  test('skips openshell profile registration when already registered', async () => {
    vi.mocked(openshell.getProfiles).mockReturnValue([{ id: 'copilot' } as unknown as never]);
    await activate(extensionContextMock);
    expect(openshell.registerProfile).not.toHaveBeenCalled();
  });

  test('registered agent supports all model types except vertexai', async () => {
    await activate(extensionContextMock);

    const agent = getRegisteredAgent();
    expect(agent.isSupportedModelType!({ name: 'openai' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'anthropic' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'ollama' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'gemini' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'vertexai' })).toBe(false);
  });

  test('registers agent with settings.json and mcp-config.json configuration files', async () => {
    await activate(extensionContextMock);

    const agent = getRegisteredAgent();
    expect(agent.configurationFiles).toHaveLength(2);
    expect(agent.configurationFiles[0]!.path).toBe(COPILOT_SETTINGS_PATH);
    expect(agent.configurationFiles[1]!.path).toBe(COPILOT_MCP_CONFIG_PATH);
  });

  test('default mcp-config.json includes mcpServers field', async () => {
    await activate(extensionContextMock);

    const agent = getRegisteredAgent();
    const mcpConfigFile = agent.configurationFiles[1]!;
    const content = JSON.parse(await mcpConfigFile.read());
    expect(content).toEqual({ mcpServers: {} });
  });

  describe('preWorkspaceStart', () => {
    test('writes model into top-level model field in settings.json', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      expect(configFile.updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({ model: 'gpt-4o' });
    });

    test('preserves existing configuration fields', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const existingConfig = JSON.stringify({ model: 'old-model', effortLevel: 'high', other: true });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile], { modelLabel: 'claude-sonnet' }));

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.model).toBe('claude-sonnet');
      expect(written.effortLevel).toBe('high');
      expect(written.other).toBe(true);
    });

    test.each([
      'null',
      '"a string"',
      '123',
      'true',
      '[1, 2]',
    ])('rejects non-object JSON: %s', async (payload: string) => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile(payload);
      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test('rejects invalid JSON', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile('not valid json');
      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test('does not write config when config file is not in context', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const updateMock = vi.fn();
      const otherFile: AgentConfigurationFile = {
        path: 'some/other/path.json',
        read: vi.fn(),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([otherFile]));

      expect(updateMock).not.toHaveBeenCalled();
    });

    describe('BYOK provider environment variables', () => {
      test('sets COPILOT_PROVIDER_BASE_URL, COPILOT_MODEL, and COPILOT_PROVIDER_TYPE for OpenAI', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'gpt-4o',
          llmMetadata: { name: 'openai' },
          endpoint: 'https://api.openai.com/v1',
        });
        await agent.preWorkspaceStart(ctx);

        expect(ctx.workspace.environment).toEqual(
          expect.arrayContaining([
            { name: 'COPILOT_PROVIDER_TYPE', value: 'openai' },
            { name: 'COPILOT_PROVIDER_BASE_URL', value: 'https://api.openai.com/v1' },
            { name: 'COPILOT_MODEL', value: 'gpt-4o' },
          ]),
        );
      });

      test('sets COPILOT_PROVIDER_TYPE to openai for Ollama and clears API key', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'qwen3',
          llmMetadata: { name: 'ollama' },
          endpoint: 'http://host.openshell.internal:11434',
        });
        await agent.preWorkspaceStart(ctx);

        expect(ctx.workspace.environment).toEqual(
          expect.arrayContaining([
            { name: 'COPILOT_PROVIDER_TYPE', value: 'openai' },
            { name: 'COPILOT_PROVIDER_BASE_URL', value: 'http://host.openshell.internal:11434' },
            { name: 'COPILOT_MODEL', value: 'qwen3' },
            { name: 'COPILOT_PROVIDER_API_KEY', value: '' },
          ]),
        );
      });

      test('sets COPILOT_PROVIDER_TYPE to anthropic for Anthropic providers with explicit endpoint', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'claude-sonnet-4',
          llmMetadata: { name: 'anthropic' },
          endpoint: 'https://custom-anthropic.example.com',
        });
        await agent.preWorkspaceStart(ctx);

        expect(ctx.workspace.environment).toEqual(
          expect.arrayContaining([
            { name: 'COPILOT_PROVIDER_TYPE', value: 'anthropic' },
            { name: 'COPILOT_PROVIDER_BASE_URL', value: 'https://custom-anthropic.example.com' },
            { name: 'COPILOT_MODEL', value: 'claude-sonnet-4' },
          ]),
        );
      });

      test('uses default base URL for Anthropic when endpoint is not set', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'claude-sonnet-4',
          llmMetadata: { name: 'anthropic' },
        });
        await agent.preWorkspaceStart(ctx);

        expect(ctx.workspace.environment).toEqual(
          expect.arrayContaining([
            { name: 'COPILOT_PROVIDER_TYPE', value: 'anthropic' },
            { name: 'COPILOT_PROVIDER_BASE_URL', value: 'https://api.anthropic.com' },
            { name: 'COPILOT_MODEL', value: 'claude-sonnet-4' },
          ]),
        );
      });

      test('does not set BYOK env vars when provider name is absent', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'gpt-4o',
          endpoint: 'https://api.openai.com/v1',
        });
        await agent.preWorkspaceStart(ctx);

        expect(ctx.workspace.environment).toBeUndefined();
      });

      test('does not set BYOK env vars when endpoint is absent and provider has no default', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'gpt-4o',
          llmMetadata: { name: 'openai' },
        });
        await agent.preWorkspaceStart(ctx);

        expect(ctx.workspace.environment).toBeUndefined();
      });

      test('does not set COPILOT_PROVIDER_TYPE for unknown provider', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'gemini-2.5-pro',
          llmMetadata: { name: 'gemini' },
          endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        });
        await agent.preWorkspaceStart(ctx);

        const envNames = ctx.workspace.environment?.map(e => e.name) ?? [];
        expect(envNames).toContain('COPILOT_PROVIDER_BASE_URL');
        expect(envNames).toContain('COPILOT_MODEL');
        expect(envNames).not.toContain('COPILOT_PROVIDER_TYPE');
      });

      test('does not set COPILOT_PROVIDER_API_KEY for non-Ollama providers', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'gpt-4o',
          llmMetadata: { name: 'openai' },
          endpoint: 'https://api.openai.com/v1',
        });
        await agent.preWorkspaceStart(ctx);

        const envNames = ctx.workspace.environment?.map(e => e.name) ?? [];
        expect(envNames).not.toContain('COPILOT_PROVIDER_API_KEY');
      });

      test('replaces existing env vars instead of duplicating', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const ctx = createContext([configFile], {
          modelLabel: 'gpt-4o',
          llmMetadata: { name: 'openai' },
          endpoint: 'https://api.openai.com/v1',
        });
        ctx.workspace.environment = [{ name: 'COPILOT_MODEL', value: 'old-model' }];

        await agent.preWorkspaceStart(ctx);

        const copilotModelEntries = ctx.workspace.environment!.filter(e => e.name === 'COPILOT_MODEL');
        expect(copilotModelEntries).toHaveLength(1);
        expect(copilotModelEntries[0]!.value).toBe('gpt-4o');
      });
    });

    describe('MCP configuration', () => {
      test('writes remote MCP servers into mcp-config.json', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            servers: [{ name: 'my-server', url: 'https://mcp.example.com/sse' }],
          },
        });
        await agent.preWorkspaceStart(ctx);

        expect(mcpFile.updateMock).toHaveBeenCalledOnce();
        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers).toEqual({
          'my-server': { type: 'http', url: 'https://mcp.example.com/sse' },
        });
      });

      test('writes remote MCP servers with headers', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            servers: [
              {
                name: 'auth-server',
                url: 'https://mcp.example.com',
                headers: { Authorization: 'Bearer token123' },
              },
            ],
          },
        });
        await agent.preWorkspaceStart(ctx);

        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers['auth-server']).toEqual({
          type: 'http',
          url: 'https://mcp.example.com',
          headers: { Authorization: 'Bearer token123' },
        });
      });

      test('omits headers when empty', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            servers: [{ name: 'no-headers', url: 'https://mcp.example.com', headers: {} }],
          },
        });
        await agent.preWorkspaceStart(ctx);

        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers['no-headers']).toEqual({
          type: 'http',
          url: 'https://mcp.example.com',
        });
      });

      test('writes stdio MCP commands into mcp-config.json', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            commands: [{ name: 'playwright', command: 'npx', args: ['@playwright/mcp@latest'] }],
          },
        });
        await agent.preWorkspaceStart(ctx);

        expect(mcpFile.updateMock).toHaveBeenCalledOnce();
        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers).toEqual({
          playwright: { type: 'local', command: 'npx', args: ['@playwright/mcp@latest'] },
        });
      });

      test('writes stdio MCP commands with env', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            commands: [
              { name: 'github', command: 'github-mcp-server', args: ['stdio'], env: { GITHUB_TOKEN: 'ghp_xxx' } },
            ],
          },
        });
        await agent.preWorkspaceStart(ctx);

        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers['github']).toEqual({
          type: 'local',
          command: 'github-mcp-server',
          args: ['stdio'],
          env: { GITHUB_TOKEN: 'ghp_xxx' },
        });
      });

      test('omits env when empty', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            commands: [{ name: 'tool', command: 'my-tool', env: {} }],
          },
        });
        await agent.preWorkspaceStart(ctx);

        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers['tool']).toEqual({
          type: 'local',
          command: 'my-tool',
          args: [],
        });
      });

      test('combines remote servers and stdio commands', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            servers: [{ name: 'remote', url: 'https://mcp.example.com' }],
            commands: [{ name: 'local', command: 'my-tool', args: ['--flag'] }],
          },
        });
        await agent.preWorkspaceStart(ctx);

        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers).toEqual({
          remote: { type: 'http', url: 'https://mcp.example.com' },
          local: { type: 'local', command: 'my-tool', args: ['--flag'] },
        });
      });

      test('preserves existing MCP server entries', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const existingMcpConfig = JSON.stringify({
          mcpServers: { existing: { type: 'http', url: 'https://old.example.com' } },
        });
        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile(existingMcpConfig);
        const ctx = createContext([configFile, mcpFile], {
          mcp: {
            servers: [{ name: 'new-server', url: 'https://new.example.com' }],
          },
        });
        await agent.preWorkspaceStart(ctx);

        const written = JSON.parse(mcpFile.updateMock.mock.calls[0]![0] as string);
        expect(written.mcpServers['existing']).toEqual({ type: 'http', url: 'https://old.example.com' });
        expect(written.mcpServers['new-server']).toEqual({ type: 'http', url: 'https://new.example.com' });
      });

      test('does not write mcp-config.json when no MCP servers or commands', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile]);
        await agent.preWorkspaceStart(ctx);

        expect(mcpFile.updateMock).not.toHaveBeenCalled();
      });

      test('does not write mcp-config.json when MCP arrays are empty', async () => {
        await activate(extensionContextMock);
        const agent = getRegisteredAgent();

        const configFile = createConfigFile();
        const mcpFile = createMcpConfigFile();
        const ctx = createContext([configFile, mcpFile], {
          mcp: { servers: [], commands: [] },
        });
        await agent.preWorkspaceStart(ctx);

        expect(mcpFile.updateMock).not.toHaveBeenCalled();
      });
    });
  });
});
