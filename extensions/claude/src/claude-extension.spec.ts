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

import type { ExtensionContext } from '@openkaiden/api';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ClaudeExtension } from '/@/claude-extension';
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

  test('activate handles error during container creation', async () => {
    const faultyGetAsync = vi.fn().mockRejectedValue(new Error('Container creation failed'));
    vi.spyOn(claudeExtension, 'getContainer').mockReturnValue({
      getAsync: faultyGetAsync,
    } as unknown as Container);
    await expect(claudeExtension.activate()).rejects.toThrow('Container creation failed');
  });

  test('deactivate disposes subscriptions', async () => {
    await claudeExtension.activate();
    await claudeExtension.deactivate();
    expect(ClaudeSkillsManager.prototype.dispose).toHaveBeenCalled();
    expect(ClaudeInferenceManager.prototype.dispose).toHaveBeenCalled();
  });
});
