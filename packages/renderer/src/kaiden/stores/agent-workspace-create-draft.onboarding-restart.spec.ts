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

import { beforeEach, expect, test, vi } from 'vitest';

const callbacks = new Map<string, () => Promise<void> | void>();

beforeEach(() => {
  callbacks.clear();
  vi.resetAllMocks();
  vi.resetModules();
  Object.defineProperty(window, 'events', {
    value: {
      receive: vi.fn((channel: string, callback: () => Promise<void> | void) => {
        callbacks.set(channel, callback);
      }),
    },
    configurable: true,
  });
});

test('onboarding:restart resets wizard.draft.initialized so the next mount re-applies onboarding defaults', async () => {
  const { wizard } = await import('./agent-workspace-create-draft.svelte');

  wizard.draft.initialized = true;

  await callbacks.get('onboarding:restart')?.();

  expect(wizard.draft.initialized).toBe(false);
});

test('onboarding:restart does not touch unrelated draft fields', async () => {
  const { wizard } = await import('./agent-workspace-create-draft.svelte');

  wizard.draft.initialized = true;
  wizard.draft.sourcePath = '/home/user/project';
  wizard.draft.sessionName = 'my-session';

  await callbacks.get('onboarding:restart')?.();

  expect(wizard.draft.sourcePath).toBe('/home/user/project');
  expect(wizard.draft.sessionName).toBe('my-session');
});
