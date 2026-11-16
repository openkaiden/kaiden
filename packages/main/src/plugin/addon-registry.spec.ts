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
import { beforeEach, expect, test } from 'vitest';

import { AddonRegistry } from './addon-registry.js';

const addon: Addon = {
  id: 'test-addon',
  name: 'Test Addon',
  description: 'A test addon',
  ociImage: 'ghcr.io/test/addon:latest',
};

let registry: AddonRegistry;

beforeEach(() => {
  registry = new AddonRegistry();
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
