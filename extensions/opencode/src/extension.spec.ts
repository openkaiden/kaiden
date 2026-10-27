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

import type { AgentConfigurationFile, AgentWorkspaceContext, Disposable, ExtensionContext } from '@openkaiden/api';
import { agents } from '@openkaiden/api';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { activate, OPENCODE_CONFIG_PATH } from './extension';

vi.mock(import('@openkaiden/api'));

const AGENT_DISPOSABLE_MOCK: Disposable = { dispose: vi.fn() };

let extensionContextMock: ExtensionContext;

beforeEach(() => {
  vi.resetAllMocks();

  extensionContextMock = {
    subscriptions: [],
  } as unknown as ExtensionContext;

  vi.mocked(agents.registerAgent).mockReturnValue(AGENT_DISPOSABLE_MOCK);
});

describe('activate', () => {
  test('registers opencode agent', async () => {
    await activate(extensionContextMock);

    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'opencode',
        name: 'OpenCode',
        description: expect.any(String),
        icon: expect.objectContaining({ icon: { dark: './icon_dark.png', light: './icon_light.png' } }),
        tags: ['Recommended'],
        destinationSkillsFolder: '${HOME}/.opencode/skills',
        isSupportedModelType: expect.any(Function),
      }),
    );
  });

  test('pushes agent disposable to subscriptions', async () => {
    await activate(extensionContextMock);

    expect(extensionContextMock.subscriptions).toContain(AGENT_DISPOSABLE_MOCK);
  });

  test('registered agent supports all model types including vertexai', async () => {
    await activate(extensionContextMock);

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.isSupportedModelType!({ name: 'openai' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'gemini' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'vertexai' })).toBe(true);
  });

  test('registers agent with opencode.json configuration file', async () => {
    await activate(extensionContextMock);

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.configurationFiles).toHaveLength(1);
    expect(agent.configurationFiles[0]!.path).toBe(OPENCODE_CONFIG_PATH);
  });

  describe('preWorkspaceStart', () => {
    function createContext(
      configFiles: AgentConfigurationFile[],
      options: {
        modelLabel?: string;
        provider?: string;
        endpoint?: string;
        mcp?: {
          servers?: { name: string; url: string; headers?: Record<string, string> }[];
          commands?: { name: string; command: string; args?: string[]; env?: Record<string, string> }[];
        };
      } = {},
    ): AgentWorkspaceContext {
      const { modelLabel = 'gpt-4o', provider, endpoint, mcp } = options;
      return {
        model: {
          model: { label: modelLabel },
          llmMetadata: provider ? { name: provider } : undefined,
          endpoint,
        },
        configurationFiles: configFiles,
        workspace: { ...(mcp ? { mcp } : {}) },
      };
    }

    function createConfigFile(content = '{}'): AgentConfigurationFile & { updateMock: ReturnType<typeof vi.fn> } {
      const updateMock = vi.fn();
      const file: AgentConfigurationFile = {
        path: OPENCODE_CONFIG_PATH,
        read: vi.fn().mockResolvedValue(content),
        update: updateMock,
      };
      return Object.assign(file, { updateMock });
    }

    test('writes model name when no provider is specified', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      expect(configFile.updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({ model: 'gpt-4o' });
    });

    test('writes provider/model format when provider is specified', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], { provider: 'anthropic', modelLabel: 'claude-sonnet' }),
      );

      expect(configFile.updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({ model: 'anthropic/claude-sonnet' });
    });

    test('adds provider block for non-native provider with endpoint', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          provider: 'ollama',
          modelLabel: 'llama3',
          endpoint: 'http://localhost:11434/v1',
        }),
      );

      expect(configFile.updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({
        model: 'ollama/llama3',
        provider: {
          ollama: {
            name: 'ollama',
            npm: '@ai-sdk/openai-compatible',
            options: { apiKey: '{env:OPENAI_API_KEY}', baseURL: 'http://localhost:11434/v1' },
            models: {
              llama3: { _launch: true, name: 'llama3' },
            },
          },
        },
      });
    });

    test('merges existing provider options instead of overwriting', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const existingConfig = JSON.stringify({
        provider: {
          ollama: {
            options: { apiKey: 'keep-me', baseURL: 'old-url' },
          },
        },
      });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(
        createContext([configFile], {
          provider: 'ollama',
          modelLabel: 'llama3',
          endpoint: 'http://localhost:11434/v1',
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.provider.ollama.options).toEqual({
        apiKey: 'keep-me',
        baseURL: 'http://localhost:11434/v1',
      });
    });

    test('throws on malformed nested provider values', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const existingConfig = JSON.stringify({
        provider: 'not-an-object',
      });
      const configFile = createConfigFile(existingConfig);
      await expect(
        agent.preWorkspaceStart(
          createContext([configFile], {
            provider: 'ollama',
            modelLabel: 'llama3',
            endpoint: 'http://localhost:11434/v1',
          }),
        ),
      ).rejects.toThrow();
    });

    test('uses native SDK for anthropic provider with custom endpoint', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          provider: 'anthropic',
          modelLabel: 'claude-sonnet',
          endpoint: 'https://custom.anthropic.example.com',
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.model).toBe('anthropic/claude-sonnet');
      expect(written.provider.anthropic.npm).toBe('@ai-sdk/anthropic');
      expect(written.provider.anthropic.options.baseURL).toBe('https://custom.anthropic.example.com');
    });

    test('renames openai provider ID to avoid OpenCode built-in loader collision', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          provider: 'openai',
          modelLabel: 'Qwen3.6-35B-A3B',
          endpoint: 'https://litellm.example.com/v1',
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.model).toBe('openai-compat/Qwen3.6-35B-A3B');
      expect(written.provider['openai-compat']).toEqual({
        name: 'openai',
        npm: '@ai-sdk/openai-compatible',
        options: { apiKey: '{env:OPENAI_API_KEY}', baseURL: 'https://litellm.example.com/v1' },
        models: {
          'Qwen3.6-35B-A3B': { _launch: true, name: 'Qwen3.6-35B-A3B' },
        },
      });
      expect(written.provider).not.toHaveProperty('openai');
    });

    test('does not add provider block for native provider with endpoint', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          provider: 'google',
          modelLabel: 'gemini-pro',
          endpoint: 'https://generativelanguage.googleapis.com',
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({ model: 'google/gemini-pro' });
    });

    test('preserves existing configuration fields', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const existingConfig = JSON.stringify({ theme: 'dark', version: 3 });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile], { modelLabel: 'gpt-4o' }));

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.theme).toBe('dark');
      expect(written.version).toBe(3);
      expect(written.model).toBe('gpt-4o');
    });

    test('throws on invalid JSON', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile('not valid json');
      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test('throws on non-object JSON', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      for (const nonObject of ['null', '"string"', '123', '[]']) {
        const configFile = createConfigFile(nonObject);

        await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
      }
    });

    test('does nothing when config file is not in context', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const otherFile: AgentConfigurationFile = {
        path: 'some/other/path.json',
        read: vi.fn(),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([otherFile]));

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('writes remote MCP servers from workspace config', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'my-remote', url: 'https://mcp.example.com' }],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'my-remote': { type: 'remote', url: 'https://mcp.example.com', enabled: true },
      });
    });

    test('writes remote MCP servers with headers', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [
              {
                name: 'authed-server',
                url: 'https://mcp.example.com',
                headers: { Authorization: 'Bearer token123' },
              },
            ],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'authed-server': {
          type: 'remote',
          url: 'https://mcp.example.com',
          enabled: true,
          headers: { Authorization: 'Bearer token123' },
        },
      });
    });

    test('writes local MCP commands from workspace config', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'my-local', command: 'npx', args: ['-y', 'my-mcp-server'] }],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'my-local': { type: 'local', command: ['npx', '-y', 'my-mcp-server'], enabled: true },
      });
    });

    test('writes local MCP commands with env variables as environment', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [
              {
                name: 'github-mcp',
                command: 'npx',
                args: ['@modelcontextprotocol/server-github'],
                env: { GITHUB_TOKEN: 'ghp_test123' },
              },
            ],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'github-mcp': {
          type: 'local',
          command: ['npx', '@modelcontextprotocol/server-github'],
          enabled: true,
          environment: { GITHUB_TOKEN: 'ghp_test123' },
        },
      });
    });

    test('writes both remote and local MCP servers together', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'remote-one', url: 'https://mcp.example.com' }],
            commands: [{ name: 'local-one', command: 'npx', args: ['my-server'] }],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'remote-one': { type: 'remote', url: 'https://mcp.example.com', enabled: true },
        'local-one': { type: 'local', command: ['npx', 'my-server'], enabled: true },
      });
    });

    test('merges MCP servers with existing MCP config', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const existingConfig = JSON.stringify({
        mcp: { 'existing-server': { type: 'remote', url: 'https://existing.example.com', enabled: true } },
      });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'new-server', url: 'https://new.example.com' }],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'existing-server': { type: 'remote', url: 'https://existing.example.com', enabled: true },
        'new-server': { type: 'remote', url: 'https://new.example.com', enabled: true },
      });
    });

    test('does not write mcp key when workspace has no MCP config', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toBeUndefined();
    });

    test('preserves existing MCP entries when workspace has no MCP config', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const existingConfig = JSON.stringify({
        mcp: { 'existing-server': { type: 'remote', url: 'https://existing.example.com', enabled: true } },
      });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp).toEqual({
        'existing-server': { type: 'remote', url: 'https://existing.example.com', enabled: true },
      });
    });

    test('omits headers when remote MCP server has empty headers', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'no-headers', url: 'https://mcp.example.com', headers: {} }],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp['no-headers']).toEqual({ type: 'remote', url: 'https://mcp.example.com', enabled: true });
      expect(written.mcp['no-headers']).not.toHaveProperty('headers');
    });

    test('omits environment when local MCP command has empty env', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'minimal', command: 'my-server', args: [], env: {} }],
          },
        }),
      );

      const written = JSON.parse(configFile.updateMock.mock.calls[0]![0] as string);
      expect(written.mcp['minimal']).toEqual({ type: 'local', command: ['my-server'], enabled: true });
      expect(written.mcp['minimal']).not.toHaveProperty('environment');
    });

    test('routes vertexai to the native vertex-anthropic provider', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], { provider: 'vertexai', modelLabel: 'claude-sonnet-4-20250514' }),
      );

      const call = configFile.updateMock.mock.calls[0];
      assert(call);
      const written = JSON.parse(call[0]);
      expect(written.model).toBe('vertex-anthropic/claude-sonnet-4-20250514');
      expect(written.provider['vertex-anthropic']).toEqual({
        name: 'vertex-anthropic',
        npm: '@ai-sdk/google-vertex/anthropic',
        options: {
          accessToken: '{env:GOOGLE_VERTEX_AI_TOKEN}',
        },
        models: {
          'claude-sonnet-4-20250514': { _launch: true, name: 'claude-sonnet-4-20250514' },
        },
      });
      expect(written.provider).not.toHaveProperty('anthropic');
      expect(written.provider).not.toHaveProperty('vertexai');
    });

    test('merges existing vertex-anthropic options and always refreshes the access token for vertexai', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const existingConfig = JSON.stringify({
        provider: {
          'vertex-anthropic': {
            options: { project: 'my-project', location: 'us-east1', accessToken: 'stale-token' },
          },
        },
      });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile], { provider: 'vertexai', modelLabel: 'claude-opus' }));

      const call = configFile.updateMock.mock.calls[0];
      assert(call);
      const written = JSON.parse(call[0]);
      expect(written.provider['vertex-anthropic'].options).toEqual({
        project: 'my-project',
        location: 'us-east1',
        accessToken: '{env:GOOGLE_VERTEX_AI_TOKEN}',
      });
    });

    test('does not inject the removed local inference endpoint env vars for vertexai', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const workspace = {
        environment: [] as { name: string; value: string }[],
      };

      const configFile = createConfigFile();
      const context: AgentWorkspaceContext = {
        model: {
          llmMetadata: { name: 'vertexai' },
          model: { label: 'claude-sonnet-4-20250514' },
        },
        configurationFiles: [configFile],
        workspace,
      };

      await agent.preWorkspaceStart(context);

      expect(workspace.environment).toEqual([]);
    });

    test('does not modify workspace environment for non-vertexai models', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const workspace = {
        environment: [{ name: 'SOME_OTHER_VAR', value: 'value' }],
      };

      const configFile = createConfigFile();
      const context: AgentWorkspaceContext = {
        model: {
          llmMetadata: { name: 'anthropic' },
          model: { label: 'claude-sonnet-4-20250514' },
        },
        configurationFiles: [configFile],
        workspace,
      };

      await agent.preWorkspaceStart(context);

      expect(workspace.environment).toEqual([{ name: 'SOME_OTHER_VAR', value: 'value' }]);
    });
  });
});
