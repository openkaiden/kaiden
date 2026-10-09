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
import { load } from 'js-yaml';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { activate, GOOSE_CONFIG_PATH } from './extension';

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
  test('registers goose agent', async () => {
    await activate(extensionContextMock);

    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'goose',
        name: 'Goose',
        description: expect.any(String),
        icon: expect.objectContaining({ icon: { dark: './icon_dark.png', light: './icon_light.png' } }),
        destinationSkillsFolder: '${HOME}/.agents/skills',
        baseImage:
          'ghcr.io/openkaiden/openshell-image-goose@sha256:25806faabdac9da5b929bf97201a47f55a5917ccebb82bb59efc25c36340260c',
        isSupportedModelType: expect.any(Function),
      }),
    );
  });

  test('pushes agent disposable to subscriptions', async () => {
    await activate(extensionContextMock);

    expect(extensionContextMock.subscriptions).toContain(AGENT_DISPOSABLE_MOCK);
  });

  // TODO: enable openshell runtime once goose is wired into the image builder

  test('registered agent supports non-vertexai model types', async () => {
    await activate(extensionContextMock);

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.isSupportedModelType!({ name: 'gemini' })).toBeTruthy();
    expect(agent.isSupportedModelType!({ name: 'openai' })).toBeTruthy();
    expect(agent.isSupportedModelType!({ name: 'anthropic' })).toBeTruthy();
    expect(agent.isSupportedModelType!({ name: 'vertexai' })).toBeFalsy();
  });

  test('registers agent with config.yaml configuration file', async () => {
    await activate(extensionContextMock);

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.configurationFiles).toHaveLength(1);
    expect(agent.configurationFiles[0]!.path).toBe(GOOSE_CONFIG_PATH);
  });

  describe('preWorkspaceStart', () => {
    let agent: ReturnType<typeof vi.mocked<typeof agents.registerAgent>>['mock']['calls'][0][0];

    beforeEach(async () => {
      await activate(extensionContextMock);
      agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    });

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
        workspace: { mcp },
      };
    }

    function createConfigFile(content = ''): AgentConfigurationFile & { updateMock: ReturnType<typeof vi.fn> } {
      const updateMock = vi.fn();
      return {
        path: GOOSE_CONFIG_PATH,
        read: vi.fn().mockResolvedValue(content),
        update: updateMock,
        updateMock,
      };
    }

    function parseWritten(updateMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
      return load(updateMock.mock.calls[0]![0] as string) as Record<string, unknown>;
    }

    test('writes model configuration into config.yaml', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      expect(configFile.updateMock).toHaveBeenCalledOnce();
      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_MODEL).toBe('gpt-4o');
    });

    test('disables telemetry without prompting', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_TELEMETRY_ENABLED).toBe(false);
    });

    test('preserves existing configuration fields', async () => {
      const configFile = createConfigFile('GOOSE_PROVIDER: openai\nGOOSE_MODEL: old-model\n');
      await agent.preWorkspaceStart(createContext([configFile], { modelLabel: 'claude-sonnet' }));

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_PROVIDER).toBe('openai');
      expect(written.GOOSE_MODEL).toBe('claude-sonnet');
    });

    test('handles empty config file', async () => {
      const configFile = createConfigFile('');
      await agent.preWorkspaceStart(createContext([configFile], { modelLabel: 'gemini-2.5-pro' }));

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_MODEL).toBe('gemini-2.5-pro');
    });

    test('replaces malformed YAML with generated configuration', async () => {
      const configFile = createConfigFile('extensions:\n  invalid: [');
      await agent.preWorkspaceStart(
        createContext([configFile], { provider: 'anthropic', modelLabel: 'claude-sonnet' }),
      );

      const written = parseWritten(configFile.updateMock);
      expect(written).toEqual({
        GOOSE_MODEL: 'claude-sonnet',
        GOOSE_TELEMETRY_ENABLED: false,
        GOOSE_PROVIDER: 'anthropic',
      });
    });

    test('replaces non-object YAML with generated configuration', async () => {
      const configFile = createConfigFile('invalid');
      await agent.preWorkspaceStart(createContext([configFile], { modelLabel: 'gpt-4o' }));

      const written = parseWritten(configFile.updateMock);
      expect(written).toEqual({
        GOOSE_MODEL: 'gpt-4o',
        GOOSE_TELEMETRY_ENABLED: false,
      });
    });

    test('does not set GOOSE_PROVIDER when no provider is given', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_PROVIDER).toBeUndefined();
    });

    test('sets GOOSE_PROVIDER from llmMetadata', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], { provider: 'anthropic', modelLabel: 'claude-sonnet' }),
      );

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_PROVIDER).toBe('anthropic');
      expect(written.GOOSE_MODEL).toBe('claude-sonnet');
    });

    test('maps gemini provider to openai', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile], { provider: 'gemini', modelLabel: 'gemini-2.5-pro' }));

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_PROVIDER).toBe('openai');
    });

    test('passes through unknown providers as-is', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], { provider: 'custom-provider', modelLabel: 'custom-model' }),
      );

      const written = parseWritten(configFile.updateMock);
      expect(written.GOOSE_PROVIDER).toBe('custom-provider');
    });

    test('sets OPENAI_BASE_URL when endpoint is provided', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          provider: 'openai',
          modelLabel: 'gpt-4o',
          endpoint: 'http://localhost:11434/v1',
        }),
      );

      const written = parseWritten(configFile.updateMock);
      expect(written.OPENAI_BASE_URL).toBe('http://localhost:11434/v1');
    });

    test('does not set OPENAI_BASE_URL when no endpoint', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile], { provider: 'openai', modelLabel: 'gpt-4o' }));

      const written = parseWritten(configFile.updateMock);
      expect(written.OPENAI_BASE_URL).toBeUndefined();
    });

    test('does nothing when config file is not in context', async () => {
      const updateMock = vi.fn();
      const otherFile: AgentConfigurationFile = {
        path: 'some/other/path.yaml',
        read: vi.fn(),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([otherFile]));

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('writes remote MCP servers as streamable_http extensions', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'my-remote', url: 'https://mcp.example.com' }],
          },
        }),
      );

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['my-remote']).toEqual({
        name: 'my-remote',
        type: 'streamable_http',
        uri: 'https://mcp.example.com',
        enabled: true,
      });
    });

    test('writes remote MCP servers with headers', async () => {
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

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['authed-server']).toEqual({
        name: 'authed-server',
        type: 'streamable_http',
        uri: 'https://mcp.example.com',
        enabled: true,
        headers: { Authorization: 'Bearer token123' },
      });
    });

    test('writes local MCP commands as stdio extensions', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'my-local', command: 'npx', args: ['-y', 'my-mcp-server'] }],
          },
        }),
      );

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['my-local']).toEqual({
        name: 'my-local',
        type: 'stdio',
        cmd: 'npx',
        args: ['-y', 'my-mcp-server'],
        enabled: true,
      });
    });

    test('writes local MCP commands with env variables', async () => {
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

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['github-mcp']).toEqual({
        name: 'github-mcp',
        type: 'stdio',
        cmd: 'npx',
        args: ['@modelcontextprotocol/server-github'],
        enabled: true,
        envs: { GITHUB_TOKEN: 'ghp_test123' },
      });
    });

    test('writes both remote and local MCP servers together', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'remote-one', url: 'https://mcp.example.com' }],
            commands: [{ name: 'local-one', command: 'npx', args: ['my-server'] }],
          },
        }),
      );

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['remote-one']).toEqual({
        name: 'remote-one',
        type: 'streamable_http',
        uri: 'https://mcp.example.com',
        enabled: true,
      });
      expect(extensions['local-one']).toEqual({
        name: 'local-one',
        type: 'stdio',
        cmd: 'npx',
        args: ['my-server'],
        enabled: true,
      });
    });

    test('merges MCP extensions with existing extensions', async () => {
      const existingConfig =
        'GOOSE_MODEL: old\nextensions:\n  existing:\n    name: existing\n    type: stdio\n    cmd: existing-cmd\n    enabled: true\n';
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'new-ext', command: 'npx', args: ['new-server'] }],
          },
        }),
      );

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['existing']).toEqual({
        name: 'existing',
        type: 'stdio',
        cmd: 'existing-cmd',
        enabled: true,
      });
      expect(extensions['new-ext']).toEqual({
        name: 'new-ext',
        type: 'stdio',
        cmd: 'npx',
        args: ['new-server'],
        enabled: true,
      });
    });

    test('does not write extensions key when workspace has no MCP config', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = parseWritten(configFile.updateMock);
      expect(written.extensions).toBeUndefined();
    });

    test('preserves existing extensions when workspace has no MCP config', async () => {
      const existingConfig =
        'extensions:\n  existing:\n    name: existing\n    type: stdio\n    cmd: my-cmd\n    enabled: true\n';
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['existing']).toEqual({
        name: 'existing',
        type: 'stdio',
        cmd: 'my-cmd',
        enabled: true,
      });
    });

    test('omits headers when remote MCP server has empty headers', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'no-headers', url: 'https://mcp.example.com', headers: {} }],
          },
        }),
      );

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['no-headers']).not.toHaveProperty('headers');
    });

    test('omits envs when local MCP command has empty env', async () => {
      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'minimal', command: 'my-server', args: [], env: {} }],
          },
        }),
      );

      const written = parseWritten(configFile.updateMock);
      const extensions = written.extensions as Record<string, Record<string, unknown>>;
      expect(extensions['minimal']).not.toHaveProperty('envs');
    });
  });
});
