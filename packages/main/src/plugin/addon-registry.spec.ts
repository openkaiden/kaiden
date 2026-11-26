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

import type { Addon, AddonRegistration } from '@openkaiden/api';
import type { IpcMainInvokeEvent } from 'electron';
import { assert, beforeEach, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

import { AddonRegistry } from './addon-registry.js';

const registration: AddonRegistration = {
  name: 'test-addon',
  displayName: 'Test Addon',
  publisher: { name: 'kaiden', displayName: 'Kaiden' },
  description: 'A test addon',
  ociImage: 'ghcr.io/test/addon:latest',
};
const addon: Addon = { ...registration, id: 'kaiden.test-addon' };

const otherRegistration: AddonRegistration = {
  name: 'other',
  displayName: 'Other',
  publisher: { name: 'kaiden', displayName: 'Kaiden' },
  ociImage: 'ghcr.io/test/other:latest',
};
const other: Addon = { ...otherRegistration, id: 'kaiden.other' };

const apiSender: ApiSenderType = { send: vi.fn(), receive: vi.fn() };
const ipcHandle: IPCHandle = vi.fn();

let registry: AddonRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  registry = new AddonRegistry(apiSender, ipcHandle);
});

test('registers addons with an id computed from the publisher and addon names', () => {
  registry.registerAddon(registration);
  registry.registerAddon(otherRegistration);
  expect(registry.getAddons()).toStrictEqual([addon, other]);
});

test('registers the same addon name for another publisher', () => {
  registry.registerAddon(registration);
  registry.registerAddon({ ...registration, publisher: { name: 'acme', displayName: 'Acme' } });
  expect(registry.getAddons().map(({ id }) => id)).toStrictEqual(['kaiden.test-addon', 'acme.test-addon']);
});

test('propagates optional category, version and icon', () => {
  const fullRegistration: AddonRegistration = {
    ...registration,
    category: 'agents',
    version: '2.56.1',
    icon: { light: 'data:image/png;base64,AAAA', dark: 'data:image/png;base64,BBBB' },
  };
  registry.registerAddon(fullRegistration);
  expect(registry.getAddons()).toStrictEqual([{ ...fullRegistration, id: 'kaiden.test-addon' }]);
});

test('rejects an addon with the same publisher and name', () => {
  registry.registerAddon(registration);
  expect(() => registry.registerAddon({ ...registration, displayName: 'Another' })).toThrow(
    `Addon with id 'kaiden.test-addon' is already registered`,
  );
  expect(registry.getAddons()).toStrictEqual([addon]);
});

test('removes an addon when its registration is disposed, using the id computed at registration', () => {
  const mutableRegistration = { ...registration };
  const disposable = registry.registerAddon(mutableRegistration);
  registry.registerAddon(otherRegistration);
  mutableRegistration.name = 'other';
  disposable.dispose();
  expect(registry.getAddons()).toStrictEqual([other]);
});

test('allows registering the same addon again after disposal', () => {
  registry.registerAddon(registration).dispose();
  registry.registerAddon(registration);
  expect(registry.getAddons()).toStrictEqual([addon]);
});

test('notifies the renderer on register and dispose', () => {
  const disposable = registry.registerAddon(registration);
  expect(apiSender.send).toHaveBeenCalledWith('addon-registry:updated');
  disposable.dispose();
  expect(apiSender.send).toHaveBeenNthCalledWith(2, 'addon-registry:updated');
});

test('init exposes addons over IPC', async () => {
  registry.init();
  registry.registerAddon(registration);
  expect(ipcHandle).toHaveBeenCalledWith('addon-registry:getAddons', expect.any(Function));
  const handler = vi.mocked(ipcHandle).mock.calls[0]?.[1];
  assert(handler);
  const result = await handler({} as IpcMainInvokeEvent);
  expect(result).toStrictEqual([addon]);
});

test('getAddon returns the addon with the given id', () => {
  registry.registerAddon(registration);
  expect(registry.getAddon('kaiden.test-addon')).toStrictEqual(addon);
  expect(registry.getAddon('test-addon')).toBeUndefined();
});

test('fires onDidChange on register and dispose', () => {
  const listener = vi.fn();
  registry.onDidChange(listener);
  registry.registerAddon(registration).dispose();
  expect(listener).toHaveBeenCalledTimes(2);
});
