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
import { assert, beforeEach, expect, test, vi } from 'vitest';

import { hostPresets, hostPresetsEventStore } from './host-presets';

const callbacks = new Map<string, () => void>();

beforeEach(() => {
  vi.resetAllMocks();
  hostPresets.set([]);
  callbacks.clear();
  Object.defineProperty(window, 'addEventListener', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
  vi.mocked(window.addEventListener).mockImplementation(
    (type: string, callback: EventListenerOrEventListenerObject): void => {
      callbacks.set(type, callback as () => void);
    },
  );
  Object.defineProperty(window, 'events', {
    value: {
      send: vi.fn(),
      receive: vi.fn(),
    },
    configurable: true,
    writable: true,
  });
  vi.mocked(window.events.receive).mockImplementation((channel, func) => {
    callbacks.set(channel, func);
    return { dispose: vi.fn() };
  });
});

test('fetches registered host presets into the store', async () => {
  const presets: HostPreset[] = [
    {
      id: 'registries',
      name: 'Registries',
      description: 'Package registries',
      hosts: [{ hostname: 'registry.npmjs.org' }],
    },
  ];
  vi.mocked(window.getHostPresets).mockResolvedValue(presets);
  hostPresetsEventStore.setup();

  const extensionsAlreadyStartedCallback = callbacks.get('extensions-already-started');
  assert(extensionsAlreadyStartedCallback);
  extensionsAlreadyStartedCallback();

  await vi.waitFor(() => expect(window.getHostPresets).toHaveBeenCalledOnce());
  expect(get(hostPresets)).toStrictEqual(presets);
});

test('updates the store when a host preset changes', async () => {
  const initialPresets: HostPreset[] = [
    {
      id: 'registries',
      name: 'Registries',
      description: 'Package registries',
      hosts: [{ hostname: 'registry.npmjs.org' }],
    },
  ];
  const updatedPresets: HostPreset[] = [
    ...initialPresets,
    {
      id: 'containers',
      name: 'Container registries',
      description: 'Container image registries',
      hosts: [{ hostname: 'registry-1.docker.io' }],
    },
  ];

  vi.mocked(window.getHostPresets).mockResolvedValue(initialPresets);
  hostPresetsEventStore.setup();

  const extensionsAlreadyStartedCallback = callbacks.get('extensions-already-started');
  assert(extensionsAlreadyStartedCallback);
  extensionsAlreadyStartedCallback();

  await vi.waitFor(() => expect(get(hostPresets)).toStrictEqual(initialPresets));

  vi.mocked(window.getHostPresets).mockResolvedValue(updatedPresets);

  const hostPresetRegistryUpdatedCallBack = callbacks.get('host-preset-registry:updated');
  assert(hostPresetRegistryUpdatedCallBack);
  hostPresetRegistryUpdatedCallBack();

  await vi.waitFor(() => expect(get(hostPresets)).toStrictEqual(updatedPresets));
});
