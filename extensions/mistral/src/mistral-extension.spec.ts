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

import { MistralInferenceManager } from '/@/manager/mistral-inference-manager';
import { MistralSkillsManager } from '/@/manager/mistral-skills-manager';
import { MistralExtension } from '/@/mistral-extension';

vi.mock(import('@openkaiden/api'));
vi.mock(import('/@/manager/mistral-skills-manager'));
vi.mock(import('/@/manager/mistral-inference-manager'));

class TestMistralExtension extends MistralExtension {
  getContainer(): Container | undefined {
    return super.getContainer();
  }
}

describe('MistralExtension', () => {
  let extensionContext: ExtensionContext;
  let mistralExtension: TestMistralExtension;

  beforeEach(() => {
    vi.resetAllMocks();
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    mistralExtension = new TestMistralExtension(extensionContext);
  });

  test('activate', async () => {
    await mistralExtension.activate();
    expect(MistralSkillsManager.prototype.init).toHaveBeenCalled();
    expect(MistralInferenceManager.prototype.init).toHaveBeenCalled();
  });

  test('activate handles error during container creation', async () => {
    const faultyGetAsync = vi.fn().mockRejectedValue(new Error('Container creation failed'));
    vi.spyOn(mistralExtension, 'getContainer').mockReturnValue({
      getAsync: faultyGetAsync,
    } as unknown as Container);
    await expect(mistralExtension.activate()).rejects.toThrow('Container creation failed');
  });

  test('deactivate disposes subscriptions', async () => {
    await mistralExtension.activate();
    await mistralExtension.deactivate();
    expect(MistralSkillsManager.prototype.dispose).toHaveBeenCalled();
    expect(MistralInferenceManager.prototype.dispose).toHaveBeenCalled();
  });
});
