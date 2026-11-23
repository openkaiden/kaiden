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

import type { Addon } from '@openkaiden/api';
import type { IpcMainInvokeEvent } from 'electron';
import { assert, beforeEach, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

import { AddonRegistry } from './addon-registry.js';

const addon: Addon = {
  id: 'test-addon',
  name: 'Test Addon',
  description: 'A test addon',
  ociImage: 'ghcr.io/test/addon:latest',
};

const apiSender: ApiSenderType = { send: vi.fn(), receive: vi.fn() };
const ipcHandle: IPCHandle = vi.fn();

let registry: AddonRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  registry = new AddonRegistry(apiSender, ipcHandle);
});

test('registers and returns addons', () => {
  registry.registerAddon(addon);
  expect(registry.getAddons()).toStrictEqual([addon]);
});

test('registers an addon without a description', () => {
  const addonWithoutDescription: Addon = { id: 'other', name: 'Other', ociImage: 'ghcr.io/test/other:latest' };
  registry.registerAddon(addon);
  registry.registerAddon(addonWithoutDescription);
  expect(registry.getAddons()).toStrictEqual([addon, addonWithoutDescription]);
});

test('propagates optional category, version and icon', () => {
  const fullAddon: Addon = {
    ...addon,
    category: 'agents',
    version: '2.56.1',
    icon: { light: 'data:image/png;base64,AAAA', dark: 'data:image/png;base64,BBBB' },
  };
  registry.registerAddon(fullAddon);
  expect(registry.getAddons()).toStrictEqual([fullAddon]);
});

test('rejects a duplicate addon id', () => {
  registry.registerAddon(addon);
  expect(() => registry.registerAddon(addon)).toThrow(`Addon with id 'test-addon' is already registered`);
  expect(registry.getAddons()).toStrictEqual([addon]);
});

test('removes an addon when its registration is disposed, using the id captured at registration', () => {
  const other: Addon = { id: 'other', name: 'Other', ociImage: 'ghcr.io/test/other:latest' };
  const mutableAddon = { ...addon };
  const registration = registry.registerAddon(mutableAddon);
  registry.registerAddon(other);
  mutableAddon.id = 'other';
  registration.dispose();
  expect(registry.getAddons()).toStrictEqual([other]);
});

test('allows registering the same id again after disposal', () => {
  registry.registerAddon(addon).dispose();
  registry.registerAddon(addon);
  expect(registry.getAddons()).toStrictEqual([addon]);
});

test('notifies the renderer on register and dispose', () => {
  const registration = registry.registerAddon(addon);
  expect(apiSender.send).toHaveBeenCalledWith('addon-registry:updated');
  registration.dispose();
  expect(apiSender.send).toHaveBeenNthCalledWith(2, 'addon-registry:updated');
});

test('init exposes addons over IPC', async () => {
  registry.init();
  registry.registerAddon(addon);
  expect(ipcHandle).toHaveBeenCalledWith('addon-registry:getAddons', expect.any(Function));
  const handler = vi.mocked(ipcHandle).mock.calls[0]?.[1];
  assert(handler);
  const result = await handler({} as IpcMainInvokeEvent);
  expect(result).toStrictEqual([addon]);
});

test.each([
  { label: 'the addon by id', query: { id: 'claude' }, expected: 'ghcr.io/test/claude:1' },
  { label: 'nothing for an unknown id', query: { id: 'missing' }, expected: undefined },
])('findAddon returns $label', ({ query, expected }) => {
  registry.registerAddon({ id: 'claude', name: 'Claude Code', ociImage: 'ghcr.io/test/claude:1', category: 'agents' });
  expect(registry.findAddon(query)?.ociImage).toBe(expected);
});
