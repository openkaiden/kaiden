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
} from '@openkaiden/api';
import { agents } from '@openkaiden/api';
import { parse, stringify } from 'smol-toml';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { activate, CODEX_CONFIG_PATH } from './extension';

const AGENT_DISPOSABLE_MOCK: Disposable = { dispose: vi.fn() };

let extensionContextMock: ExtensionContext;

beforeEach(() => {
  vi.resetAllMocks();

  extensionContextMock = {
    subscriptions: [],
  } as unknown as ExtensionContext;

  vi.mocked(agents.registerAgent).mockReturnValue(AGENT_DISPOSABLE_MOCK);
});

function getRegisteredAgent(): Agent {
  return vi.mocked(agents.registerAgent).mock.calls[0]![0];
}

function createContext(
  configFiles: AgentConfigurationFile[],
  options: {
    modelLabel?: string;
    endpoint?: string;
    mcp?: {
      servers?: { name: string; url: string; headers?: Record<string, string> }[];
      commands?: { name: string; command: string; args?: string[]; env?: Record<string, string> }[];
    };
  } = {},
): AgentWorkspaceContext {
  const { modelLabel = 'gpt-4o', endpoint, mcp } = options;
  return {
    model: {
      model: { label: modelLabel },
      ...(endpoint !== undefined ? { endpoint } : {}),
    },
    configurationFiles: configFiles,
    workspace: { ...(mcp ? { mcp } : {}) },
  };
}

function createConfigFile(content = ''): AgentConfigurationFile & { updateMock: ReturnType<typeof vi.fn> } {
  const updateMock = vi.fn();
  const file: AgentConfigurationFile = {
    path: CODEX_CONFIG_PATH,
    read: vi.fn().mockResolvedValue(content),
    update: updateMock,
  };
  return Object.assign(file, { updateMock });
}

function parseWrittenToml(updateMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return parse(updateMock.mock.calls[0]![0] as string);
}

describe('activate', () => {
  test('registers codex agent', async () => {
    await activate(extensionContextMock);

    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'codex',
        name: 'Codex',
        description: expect.any(String),
        icon: expect.objectContaining({ icon: './icon.png' }),
        destinationSkillsFolder: '${HOME}/.agents/skills',
        isSupportedModelType: expect.any(Function),
      }),
    );
  });

  test('pushes agent disposable to subscriptions', async () => {
    await activate(extensionContextMock);

    expect(extensionContextMock.subscriptions).toContain(AGENT_DISPOSABLE_MOCK);
  });

  test('registered agent supports only openai model type', async () => {
    await activate(extensionContextMock);

    const agent = getRegisteredAgent();
    expect(agent.isSupportedModelType!({ name: 'openai' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'gemini' })).toBe(false);
    expect(agent.isSupportedModelType!({ name: 'vertexai' })).toBe(false);
  });

  test('registers agent with config.toml configuration file', async () => {
    await activate(extensionContextMock);

    const agent = getRegisteredAgent();
    expect(agent.configurationFiles).toHaveLength(1);
    expect(agent.configurationFiles[0]!.path).toBe(CODEX_CONFIG_PATH);
  });

  describe('preWorkspaceStart', () => {
    test('writes model configuration into config.toml', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      expect(configFile.updateMock).toHaveBeenCalledOnce();
      const written = parseWrittenToml(configFile.updateMock);
      expect(written).toEqual({ model: 'gpt-4o' });
    });

    test('preserves existing configuration fields', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const existingConfig = stringify({ model: 'old-model', approval_mode: 'suggest' });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile], { modelLabel: 'o4-mini' }));

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.model).toBe('o4-mini');
      expect(written.approval_mode).toBe('suggest');
    });

    test('rejects invalid TOML', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile('not = [valid toml');
      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test('does nothing when config file is not in context', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const updateMock = vi.fn();
      const otherFile: AgentConfigurationFile = {
        path: 'some/other/path.toml',
        read: vi.fn(),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([otherFile]));

      expect(updateMock).not.toHaveBeenCalled();
    });

    test('writes stdio MCP commands from workspace config', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'my-local', command: 'npx', args: ['-y', 'my-mcp-server'] }],
          },
        }),
      );

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'my-local': { command: 'npx', args: ['-y', 'my-mcp-server'] },
      });
    });

    test('writes stdio MCP commands with env variables', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

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

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'github-mcp': {
          command: 'npx',
          args: ['@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'ghp_test123' },
        },
      });
    });

    test('writes HTTP MCP servers from workspace config', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'my-remote', url: 'https://mcp.example.com' }],
          },
        }),
      );

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'my-remote': { url: 'https://mcp.example.com' },
      });
    });

    test('writes HTTP MCP servers with headers', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

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

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'authed-server': {
          url: 'https://mcp.example.com',
          http_headers: { Authorization: 'Bearer token123' },
        },
      });
    });

    test('writes both stdio and HTTP MCP servers together', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'remote-one', url: 'https://mcp.example.com' }],
            commands: [{ name: 'local-one', command: 'npx', args: ['my-server'] }],
          },
        }),
      );

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'local-one': { command: 'npx', args: ['my-server'] },
        'remote-one': { url: 'https://mcp.example.com' },
      });
    });

    test('merges MCP servers with existing mcp_servers config', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const existingConfig = stringify({
        mcp_servers: { 'existing-server': { url: 'https://existing.example.com' } },
      });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'new-server', url: 'https://new.example.com' }],
          },
        }),
      );

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'existing-server': { url: 'https://existing.example.com' },
        'new-server': { url: 'https://new.example.com' },
      });
    });

    test('does not write mcp_servers key when workspace has no MCP config', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toBeUndefined();
    });

    test('preserves existing mcp_servers when workspace has no MCP config', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const existingConfig = stringify({
        mcp_servers: { 'existing-server': { url: 'https://existing.example.com' } },
      });
      const configFile = createConfigFile(existingConfig);
      await agent.preWorkspaceStart(createContext([configFile]));

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'existing-server': { url: 'https://existing.example.com' },
      });
    });

    test('omits http_headers when HTTP MCP server has empty headers', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            servers: [{ name: 'no-headers', url: 'https://mcp.example.com', headers: {} }],
          },
        }),
      );

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        'no-headers': { url: 'https://mcp.example.com' },
      });
    });

    test('omits env when stdio MCP command has empty env', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      await agent.preWorkspaceStart(
        createContext([configFile], {
          mcp: {
            commands: [{ name: 'minimal', command: 'my-server', args: [], env: {} }],
          },
        }),
      );

      const written = parseWrittenToml(configFile.updateMock);
      expect(written.mcp_servers).toEqual({
        minimal: { command: 'my-server', args: [] },
      });
    });

    test('writes openai_base_url when model has a custom endpoint', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      const ctx = createContext([configFile], { endpoint: 'https://my-custom-host.local/v1' });
      await agent.preWorkspaceStart(ctx);

      expect(parseWrittenToml(configFile.updateMock)).toEqual({
        model: 'gpt-4o',
        openai_base_url: 'https://my-custom-host.local/v1',
      });
    });

    test('does not write openai_base_url when no endpoint is provided', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile();
      const ctx = createContext([configFile]);
      await agent.preWorkspaceStart(ctx);

      expect(parseWrittenToml(configFile.updateMock)).toEqual({ model: 'gpt-4o' });
    });

    test('replaces existing openai_base_url with the model endpoint', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile(
        stringify({ model: 'old-model', openai_base_url: 'https://old-endpoint.local/v1' }),
      );
      const ctx = createContext([configFile], { endpoint: 'https://custom.example.com/v1' });
      await agent.preWorkspaceStart(ctx);

      expect(parseWrittenToml(configFile.updateMock)).toEqual({
        model: 'gpt-4o',
        openai_base_url: 'https://custom.example.com/v1',
      });
    });

    test('preserves other configuration when writing openai_base_url', async () => {
      await activate(extensionContextMock);
      const agent = getRegisteredAgent();

      const configFile = createConfigFile(stringify({ approval_policy: 'on-request' }));
      const ctx = createContext([configFile], { endpoint: 'https://new-endpoint.local/v1' });
      await agent.preWorkspaceStart(ctx);

      expect(parseWrittenToml(configFile.updateMock)).toEqual({
        model: 'gpt-4o',
        openai_base_url: 'https://new-endpoint.local/v1',
        approval_policy: 'on-request',
      });
    });
  });
});
