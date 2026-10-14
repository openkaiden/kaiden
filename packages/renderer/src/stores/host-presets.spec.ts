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

import type { HostPreset } from '@openkaiden/api';
import { get } from 'svelte/store';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';

import { hostPresetEventStore, hostPresets } from './host-presets';

let extensionsAlreadyStartedCallback: EventListenerOrEventListenerObject;

beforeAll(() => {
  window.addEventListener = vi.fn();
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.addEventListener).mockImplementation(
    (type: string, callback: EventListenerOrEventListenerObject): void => {
      extensionsAlreadyStartedCallback = callback;
    },
  );
});

test('fetches registered host presets into the store', async () => {
  const presets: HostPreset[] = [
    { id: 'registries', name: 'Registries', description: 'Package registries', hosts: ['registry.npmjs.org'] },
  ];
  vi.mocked(window.getHostPresets).mockResolvedValue(presets);
  hostPresetEventStore.setup();

  if (typeof extensionsAlreadyStartedCallback === 'function') {
    extensionsAlreadyStartedCallback(new Event('extensions-already-started'));
  } else {
    extensionsAlreadyStartedCallback.handleEvent(new Event('extensions-already-started'));
  }

  await vi.waitFor(() => expect(window.getHostPresets).toHaveBeenCalledOnce());
  expect(get(hostPresets)).toStrictEqual(presets);
});
