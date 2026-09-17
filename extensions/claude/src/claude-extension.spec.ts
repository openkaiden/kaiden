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

import type { AgentConfigurationFile, AgentWorkspaceContext, ExtensionContext } from '@openkaiden/api';
import { agents } from '@openkaiden/api';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CLAUDE_JSON_PATH, CLAUDE_SETTINGS_PATH, ClaudeExtension } from '/@/claude-extension';
import { ClaudeInferenceManager } from '/@/manager/claude-inference-manager';
import { ClaudeSkillsManager } from '/@/manager/claude-skills-manager';

vi.mock(import('@openkaiden/api'));
vi.mock(import('/@/manager/claude-skills-manager'));
vi.mock(import('/@/manager/claude-inference-manager'));

class TestClaudeExtension extends ClaudeExtension {
  getContainer(): Container | undefined {
    return super.getContainer();
  }
}

describe('ClaudeExtension', () => {
  let extensionContext: ExtensionContext;
  let claudeExtension: TestClaudeExtension;

  beforeEach(() => {
    vi.resetAllMocks();
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    claudeExtension = new TestClaudeExtension(extensionContext);
  });

  test('activate', async () => {
    await claudeExtension.activate();
    expect(ClaudeSkillsManager.prototype.init).toHaveBeenCalled();
    expect(ClaudeInferenceManager.prototype.init).toHaveBeenCalled();
  });

  test('activate registers agent', async () => {
    await claudeExtension.activate();

    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'claude',
        name: 'Claude Code',
        description: expect.any(String),
        icon: expect.objectContaining({ icon: './icon.png' }),
        baseImage: 'ghcr.io/openkaiden/openshell-image-claude:fd194d5bde14bf758c82bb2aace23fea596dfbde',
        acp: { command: 'claude-agent-acp', args: [] },
        tags: ['Cloud'],
        destinationSkillsFolder: '${HOME}/.claude/skills',
        isSupportedModelType: expect.any(Function),
      }),
    );
  });

  test('registered agent supports anthropic and vertexai model types', async () => {
    await claudeExtension.activate();

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.isSupportedModelType!({ name: 'anthropic' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'vertexai' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'openai' })).toBe(false);
  });

  test('activate handles error during container creation', async () => {
    const faultyGetAsync = vi.fn().mockRejectedValue(new Error('Container creation failed'));
    vi.spyOn(claudeExtension, 'getContainer').mockReturnValue({
      getAsync: faultyGetAsync,
    } as unknown as Container);
    await expect(claudeExtension.activate()).rejects.toThrow('Container creation failed');
  });

  test('deactivate disposes agent registration', async () => {
    const disposeMock = vi.fn();
    vi.mocked(agents.registerAgent).mockReturnValue({ dispose: disposeMock });

    await claudeExtension.activate();
    await claudeExtension.deactivate();

    expect(disposeMock).toHaveBeenCalled();
  });

  test('deactivate disposes subscriptions', async () => {
    await claudeExtension.activate();
    await claudeExtension.deactivate();
    expect(ClaudeSkillsManager.prototype.dispose).toHaveBeenCalled();
    expect(ClaudeInferenceManager.prototype.dispose).toHaveBeenCalled();
  });

  test('registers agent with configuration files', async () => {
    await claudeExtension.activate();

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.configurationFiles).toHaveLength(2);
    expect(agent.configurationFiles[0]!.path).toBe(CLAUDE_SETTINGS_PATH);
    expect(agent.configurationFiles[1]!.path).toBe(CLAUDE_JSON_PATH);
  });

  describe('preWorkspaceStart', () => {
    function createContext(
      configFiles: AgentConfigurationFile[],
      modelLabel = 'claude-sonnet-4-20250514',
      workspace: AgentWorkspaceContext['workspace'] = {},
    ): AgentWorkspaceContext {
      return {
        model: {
          model: { label: modelLabel },
        },
        configurationFiles: configFiles,
        workspace,
      };
    }

    test('writes model label to settings', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_SETTINGS_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile]));

      expect(updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({ model: 'claude-sonnet-4-20250514' });
    });

    test('preserves existing config fields', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const existingConfig = JSON.stringify({ existingKey: 'existingValue' });
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_SETTINGS_PATH,
        read: vi.fn().mockResolvedValue(existingConfig),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile], 'claude-opus-4-20250514'));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.existingKey).toBe('existingValue');
      expect(written.model).toBe('claude-opus-4-20250514');
    });

    test('rejects invalid JSON', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile: AgentConfigurationFile = {
        path: CLAUDE_SETTINGS_PATH,
        read: vi.fn().mockResolvedValue('not valid json'),
        update: vi.fn(),
      };

      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test.each(['null', '"string"', '123', '[]'])('rejects non-object JSON: %s', async (payload: string) => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile: AgentConfigurationFile = {
        path: CLAUDE_SETTINGS_PATH,
        read: vi.fn().mockResolvedValue(payload),
        update: vi.fn(),
      };

      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test('does nothing when config file is not in context', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const otherFile: AgentConfigurationFile = {
        path: 'some/other/path.json',
        read: vi.fn(),
        update: vi.fn(),
      };
      await agent.preWorkspaceStart(createContext([otherFile]));

      expect(otherFile.read).not.toHaveBeenCalled();
      expect(otherFile.update).not.toHaveBeenCalled();
    });

    test('skips onboarding in .claude.json', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile]));

      expect(updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.hasCompletedOnboarding).toBe(true);
      expect(written.projects['/sandbox'].hasTrustDialogAccepted).toBe(true);
      expect(written.customApiKeyResponses).toEqual({
        approved: ['unused'],
        rejected: [],
      });
    });

    test('approves unused Claude API key response in .claude.json', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const existing = JSON.stringify({
        customApiKeyResponses: {
          approved: ['existing'],
          rejected: ['unused', 'other'],
        },
      });
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue(existing),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile]));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.customApiKeyResponses).toEqual({
        approved: ['existing', 'unused'],
        rejected: ['other'],
      });
    });

    test('writes command MCP servers as stdio in .claude.json', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      const workspace = {
        mcp: {
          commands: [{ name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp'] }],
        },
      };

      await agent.preWorkspaceStart(createContext([configFile], undefined, workspace));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.mcpServers).toEqual({
        playwright: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@playwright/mcp'],
          env: {},
        },
      });
    });

    test('writes URL MCP servers as sse in .claude.json', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      const workspace = {
        mcp: {
          servers: [{ name: 'github', url: 'https://api.github.com/mcp', headers: { Authorization: 'Bearer tok' } }],
        },
      };

      await agent.preWorkspaceStart(createContext([configFile], undefined, workspace));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.mcpServers).toEqual({
        github: {
          type: 'sse',
          url: 'https://api.github.com/mcp',
          headers: { Authorization: 'Bearer tok' },
        },
      });
    });

    test('omits headers when empty in URL MCP servers', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      const workspace = {
        mcp: {
          servers: [{ name: 'github', url: 'https://api.github.com/mcp' }],
        },
      };

      await agent.preWorkspaceStart(createContext([configFile], undefined, workspace));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.mcpServers.github).toEqual({ type: 'sse', url: 'https://api.github.com/mcp' });
    });

    test('does not set mcpServers when workspace has no MCP config', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile]));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.mcpServers).toBeUndefined();
    });

    test('.claude.json preserves existing fields', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const existing = JSON.stringify({ projects: { '/workspace': { hasTrustDialogAccepted: true } } });
      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue(existing),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile]));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.projects['/workspace']).toEqual({ hasTrustDialogAccepted: true });
      expect(written.hasCompletedOnboarding).toBe(true);
    });

    test('.claude.json rejects invalid JSON', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue('not valid json'),
        update: vi.fn(),
      };

      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test.each([
      'null',
      '"string"',
      '123',
      '[]',
    ])('.claude.json rejects non-object JSON: %s', async (payload: string) => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile: AgentConfigurationFile = {
        path: CLAUDE_JSON_PATH,
        read: vi.fn().mockResolvedValue(payload),
        update: vi.fn(),
      };

      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test('adds Vertex AI environment variables when using vertexai model', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const workspace = {
        environment: [],
      };

      const context: AgentWorkspaceContext = {
        model: {
          llmMetadata: { name: 'vertexai' },
          model: { label: 'claude-sonnet-4-20250514' },
        },
        configurationFiles: [],
        workspace,
      };

      await agent.preWorkspaceStart(context);

      expect(workspace.environment).toContainEqual({ name: 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', value: '1' });
      expect(workspace.environment).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'CLAUDE_CODE_SIMPLE' })]),
      );
      expect(workspace.environment).toContainEqual({ name: 'ANTHROPIC_BASE_URL', value: 'https://inference.local' });
      expect(workspace.environment).toContainEqual({ name: 'ANTHROPIC_API_KEY', value: 'unused' });
    });

    test('does not add Vertex AI environment variables for non-vertexai models', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const workspace = {
        environment: [{ name: 'SOME_OTHER_VAR', value: 'value' }],
      };

      const context: AgentWorkspaceContext = {
        model: {
          llmMetadata: { name: 'anthropic' },
          model: { label: 'claude-sonnet-4-20250514' },
        },
        configurationFiles: [],
        workspace,
      };

      await agent.preWorkspaceStart(context);

      expect(workspace.environment).toHaveLength(1);
      expect(workspace.environment).toEqual([{ name: 'SOME_OTHER_VAR', value: 'value' }]);
    });

    test('replaces existing Vertex AI environment variables', async () => {
      await claudeExtension.activate();
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const workspace = {
        environment: [
          { name: 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', value: '0' },
          { name: 'CLAUDE_CODE_SIMPLE', value: '1' },
          { name: 'ANTHROPIC_BASE_URL', value: 'https://api.anthropic.com' },
          { name: 'ANTHROPIC_API_KEY', value: 'mykey' },
        ],
      };

      const context: AgentWorkspaceContext = {
        model: {
          llmMetadata: { name: 'vertexai' },
          model: { label: 'claude-sonnet-4-20250514' },
        },
        configurationFiles: [],
        workspace,
      };

      await agent.preWorkspaceStart(context);

      const claudeCodeDisableExperimentalBetas = workspace.environment.filter(
        e => e.name === 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
      );
      const claudeCodeUseSimple = workspace.environment.filter(e => e.name === 'CLAUDE_CODE_SIMPLE');
      const anthropicBaseURL = workspace.environment.filter(e => e.name === 'ANTHROPIC_BASE_URL');
      const anthropicKey = workspace.environment.filter(e => e.name === 'ANTHROPIC_API_KEY');

      expect(claudeCodeDisableExperimentalBetas).toHaveLength(1);
      expect(claudeCodeDisableExperimentalBetas[0]).toEqual({
        name: 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
        value: '1',
      });
      expect(claudeCodeUseSimple).toHaveLength(0);
      expect(anthropicBaseURL).toHaveLength(1);
      expect(anthropicBaseURL[0]).toEqual({ name: 'ANTHROPIC_BASE_URL', value: 'https://inference.local' });
      expect(anthropicKey).toHaveLength(1);
      expect(anthropicKey[0]).toEqual({ name: 'ANTHROPIC_API_KEY', value: 'unused' });
    });
  });
});
