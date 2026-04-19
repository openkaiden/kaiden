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

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Disposable, Provider } from '@openkaiden/api';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { MistralProviderSymbol } from '/@/inject/symbol';

import { MistralSkillsManager } from './mistral-skills-manager';

vi.mock(import('node:os'));
vi.mock(import('node:fs/promises'));

const MOCK_HOME = '/home/testuser';
const DEFAULT_SKILLS_DIR = join(MOCK_HOME, '.vibe', 'skills');
const CONFIG_PATH = join(MOCK_HOME, '.vibe', 'config.toml');

const disposableMock: Disposable = { dispose: vi.fn() };
const providerMock: Provider = {
  registerSkill: vi.fn(),
} as unknown as Provider;

describe('MistralSkillsManager', () => {
  let mistralSkillsManager: MistralSkillsManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.mocked(homedir).mockReturnValue(MOCK_HOME);
    vi.mocked(providerMock.registerSkill).mockReturnValue(disposableMock);

    const container = new Container();
    container.bind(MistralSkillsManager).toSelf();
    container.bind(MistralProviderSymbol).toConstantValue(providerMock);
    mistralSkillsManager = await container.getAsync<MistralSkillsManager>(MistralSkillsManager);
  });

  test('getDefaultSkillsDir returns expected path', () => {
    expect(MistralSkillsManager.getDefaultSkillsDir()).toBe(DEFAULT_SKILLS_DIR);
  });

  test('getConfigPath returns expected path', () => {
    expect(MistralSkillsManager.getConfigPath()).toBe(CONFIG_PATH);
  });

  test('registers default skill path when config file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await mistralSkillsManager.init();

    expect(providerMock.registerSkill).toHaveBeenCalledOnce();
    expect(providerMock.registerSkill).toHaveBeenCalledWith({
      label: 'Mistral',
      path: DEFAULT_SKILLS_DIR,
    });
  });

  test('registers default and config skill paths when config has skill_paths', async () => {
    vi.mocked(readFile).mockResolvedValue('skill_paths = ["/extra/path1", "/extra/path2"]');

    await mistralSkillsManager.init();

    expect(providerMock.registerSkill).toHaveBeenCalledTimes(3);
    expect(providerMock.registerSkill).toHaveBeenNthCalledWith(1, {
      label: 'Mistral',
      path: DEFAULT_SKILLS_DIR,
    });
    expect(providerMock.registerSkill).toHaveBeenNthCalledWith(2, {
      label: 'Mistral',
      path: '/extra/path1',
    });
    expect(providerMock.registerSkill).toHaveBeenNthCalledWith(3, {
      label: 'Mistral',
      path: '/extra/path2',
    });
  });

  test('registers only default path when config exists but has no skill_paths', async () => {
    vi.mocked(readFile).mockResolvedValue('[other]\nkey = "value"');

    await mistralSkillsManager.init();

    expect(providerMock.registerSkill).toHaveBeenCalledOnce();
    expect(providerMock.registerSkill).toHaveBeenCalledWith({
      label: 'Mistral',
      path: DEFAULT_SKILLS_DIR,
    });
  });

  test('registers only default path when config has invalid TOML', async () => {
    vi.mocked(readFile).mockResolvedValue('this is not valid toml {{{');

    await mistralSkillsManager.init();

    expect(providerMock.registerSkill).toHaveBeenCalledOnce();
    expect(providerMock.registerSkill).toHaveBeenCalledWith({
      label: 'Mistral',
      path: DEFAULT_SKILLS_DIR,
    });
  });

  test('dispose cleans up all skill registrations', async () => {
    vi.mocked(readFile).mockResolvedValue('skill_paths = ["/extra/path1"]');

    await mistralSkillsManager.init();
    mistralSkillsManager.dispose();

    expect(disposableMock.dispose).toHaveBeenCalledTimes(2);
  });
});
