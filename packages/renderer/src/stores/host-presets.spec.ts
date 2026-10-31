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

import type * as HostPresetsModule from './host-presets';

const eventCallbacks = new Map<string, (...args: unknown[]) => void>();
const windowListeners = new Map<string, EventListenerOrEventListenerObject>();
let hostPresetsModule: typeof HostPresetsModule | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  eventCallbacks.clear();
  windowListeners.clear();
  Object.assign(window, {
    addEventListener: vi.fn(),
    events: {
      send: vi.fn(),
      receive: vi.fn(),
    },
  });
  vi.mocked(window.addEventListener).mockImplementation(
    (type: string, callback: EventListenerOrEventListenerObject): void => {
      windowListeners.set(type, callback);
    },
  );
  vi.mocked(window.events.receive).mockImplementation((channel, callback) => {
    eventCallbacks.set(channel, callback);
    return { dispose: vi.fn() };
  });

  vi.resetModules();
  hostPresetsModule = await import('./host-presets');
  hostPresetsModule.hostPresets.set([]);
});

test('waits for extensions to start before fetching host presets', async () => {
  const presets: HostPreset[] = [
    {
      id: 'registries',
      name: 'Registries',
      description: 'Package registries',
      hosts: [{ hostname: 'registry.npmjs.org' }],
    },
  ];
  vi.mocked(window.getHostPresets).mockResolvedValue(presets);
  assert(hostPresetsModule);
  const { hostPresets } = hostPresetsModule;

  const hostPresetRegistryUpdatedCallback = eventCallbacks.get('host-preset-registry:updated');
  assert(hostPresetRegistryUpdatedCallback);
  hostPresetRegistryUpdatedCallback();

  expect(window.getHostPresets).not.toHaveBeenCalled();
  expect(get(hostPresets)).toStrictEqual([]);

  const extensionsAlreadyStartedCallback = windowListeners.get('extensions-already-started');
  assert(extensionsAlreadyStartedCallback);
  if (typeof extensionsAlreadyStartedCallback === 'function') {
    extensionsAlreadyStartedCallback(new Event('extensions-already-started'));
  } else {
    extensionsAlreadyStartedCallback.handleEvent(new Event('extensions-already-started'));
  }

  await vi.waitFor(() => expect(get(hostPresets)).toStrictEqual(presets));
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
  assert(hostPresetsModule);
  const { hostPresets } = hostPresetsModule;

  const extensionsAlreadyStartedCallback = windowListeners.get('extensions-already-started');
  assert(extensionsAlreadyStartedCallback);
  if (typeof extensionsAlreadyStartedCallback === 'function') {
    extensionsAlreadyStartedCallback(new Event('extensions-already-started'));
  } else {
    extensionsAlreadyStartedCallback.handleEvent(new Event('extensions-already-started'));
  }

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
  assert(hostPresetsModule);
  const { hostPresets } = hostPresetsModule;

  const extensionsAlreadyStartedCallback = windowListeners.get('extensions-already-started');
  assert(extensionsAlreadyStartedCallback);
  if (typeof extensionsAlreadyStartedCallback === 'function') {
    extensionsAlreadyStartedCallback(new Event('extensions-already-started'));
  } else {
    extensionsAlreadyStartedCallback.handleEvent(new Event('extensions-already-started'));
  }

  await vi.waitFor(() => expect(get(hostPresets)).toStrictEqual(initialPresets));

  vi.mocked(window.getHostPresets).mockResolvedValue(updatedPresets);

  const hostPresetRegistryUpdatedCallBack = eventCallbacks.get('host-preset-registry:updated');
  assert(hostPresetRegistryUpdatedCallBack);
  hostPresetRegistryUpdatedCallBack();

  await vi.waitFor(() => expect(get(hostPresets)).toStrictEqual(updatedPresets));
});
