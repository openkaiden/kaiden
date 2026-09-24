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
import { agents, openshell } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { CursorExtension } from './cursor-extension';
import { activate, CURSOR_CLI_CONFIG_PATH } from './extension';

vi.mock(import('@openkaiden/api'));
vi.mock(import('./cursor-extension'));
vi.mock('./cursor.yaml?raw', () => ({ default: 'id: cursor\ndisplay_name: Cursor\n' }));

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

describe('activate', () => {
  test('creates Cursor extension', async () => {
    await activate(extensionContextMock);

    expect(CursorExtension).toHaveBeenCalledWith(extensionContextMock);
    expect(vi.mocked(CursorExtension.prototype.activate)).toHaveBeenCalled();
  });

  test('registers cursor agent', async () => {
    await activate(extensionContextMock);

    expect(agents.registerAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cursor',
        name: 'Cursor CLI',
        description: expect.any(String),
        icon: expect.objectContaining({
          icon: { dark: './APP_ICON_2D_DARK.png', light: './APP_ICON_2D_LIGHT.png' },
        }),
        tags: ['Local'],
        destinationSkillsFolder: '${HOME}/.cursor/skills',
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
        id: 'cursor',
        display_name: 'Cursor',
      }),
    );
  });

  test('skips openshell profile registration when already registered', async () => {
    vi.mocked(openshell.getProfiles).mockReturnValue([{ id: 'cursor' } as unknown as never]);
    await activate(extensionContextMock);
    expect(openshell.registerProfile).not.toHaveBeenCalled();
  });

  test('registered agent supports only cursor model type', async () => {
    await activate(extensionContextMock);

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.isSupportedModelType!({ name: 'cursor' })).toBe(true);
    expect(agent.isSupportedModelType!({ name: 'openai' })).toBe(false);
    expect(agent.isSupportedModelType!({ name: 'anthropic' })).toBe(false);
  });

  test('registers agent with cli-config.json configuration file', async () => {
    await activate(extensionContextMock);

    const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];
    expect(agent.configurationFiles).toHaveLength(1);
    expect(agent.configurationFiles[0]!.path).toBe(CURSOR_CLI_CONFIG_PATH);
  });

  describe('preWorkspaceStart', () => {
    function createContext(configFiles: AgentConfigurationFile[], modelLabel = 'gpt-4o'): AgentWorkspaceContext {
      return {
        model: {
          model: { label: modelLabel },
        },
        configurationFiles: configFiles,
        workspace: {},
      };
    }

    test('writes model configuration into cli-config.json', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const configFile: AgentConfigurationFile = {
        path: CURSOR_CLI_CONFIG_PATH,
        read: vi.fn().mockResolvedValue('{}'),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile]));

      expect(updateMock).toHaveBeenCalledOnce();
      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written).toEqual({
        model: {
          modelId: 'gpt-4o',
          displayModelId: 'gpt-4o',
          displayName: 'gpt-4o',
          displayNameShort: 'gpt-4o',
          maxMode: false,
        },
        hasChangedDefaultModel: true,
      });
    });

    test('preserves existing configuration fields', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const updateMock = vi.fn();
      const existingConfig = JSON.stringify({ customSetting: 'keep-me', version: 2 });
      const configFile: AgentConfigurationFile = {
        path: CURSOR_CLI_CONFIG_PATH,
        read: vi.fn().mockResolvedValue(existingConfig),
        update: updateMock,
      };

      await agent.preWorkspaceStart(createContext([configFile], 'claude-sonnet'));

      const written = JSON.parse(updateMock.mock.calls[0]![0] as string);
      expect(written.customSetting).toBe('keep-me');
      expect(written.version).toBe(2);
      expect(written.model.modelId).toBe('claude-sonnet');
    });

    test('rejects invalid JSON', async () => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile: AgentConfigurationFile = {
        path: CURSOR_CLI_CONFIG_PATH,
        read: vi.fn().mockResolvedValue('not valid json'),
        update: vi.fn(),
      };

      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
    });

    test.each(['null', '"string"', '123', '[]'])('rejects non-object JSON: %s', async (payload: string) => {
      await activate(extensionContextMock);
      const agent = vi.mocked(agents.registerAgent).mock.calls[0]![0];

      const configFile: AgentConfigurationFile = {
        path: CURSOR_CLI_CONFIG_PATH,
        read: vi.fn().mockResolvedValue(payload),
        update: vi.fn(),
      };

      await expect(agent.preWorkspaceStart(createContext([configFile]))).rejects.toThrow();
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
  });
});
