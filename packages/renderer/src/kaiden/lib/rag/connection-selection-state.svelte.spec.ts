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

import { beforeEach, expect, test } from 'vitest';

import type { ProviderInfo } from '/@api/provider-info';

import { type ConnectionOption, ConnectionSelectionState } from './connection-selection-state.svelte';

function buildFactory(id: string): ProviderInfo {
  return {
    internalId: `${id}-internal`,
    id,
    extensionId: 'extension',
    name: id,
    containerConnections: [],
    kubernetesConnections: [],
    vmConnections: [],
    inferenceConnections: [],
    ragConnections: [],
    chunkConnections: [],
    status: 'started',
    containerProviderConnectionCreation: false,
    containerProviderConnectionInitialization: false,
    kubernetesProviderConnectionCreation: false,
    kubernetesProviderConnectionInitialization: false,
    vmProviderConnectionCreation: false,
    vmProviderConnectionInitialization: false,
    inferenceProviderConnectionCreation: false,
    inferenceProviderConnectionInitialization: false,
    ragProviderConnectionCreation: true,
    ragProviderConnectionInitialization: false,
    chunkProviderConnectionCreation: false,
    chunkProviderConnectionInitialization: false,
    links: [],
    detectionChecks: [],
    warnings: [],
    images: {},
    installationSupport: false,
    cleanupSupport: false,
  };
}

function buildOption(providerId: string, name: string): ConnectionOption {
  return { key: `${providerId}:${name}`, providerId, displayName: name, providerName: providerId };
}

const milvus = buildFactory('milvus');
const other = buildFactory('other');

let options = $state<ConnectionOption[]>([]);
let factoryProviders = $state<ProviderInfo[]>([]);
let selection: ConnectionSelectionState;

beforeEach(() => {
  options = [];
  factoryProviders = [];
  selection = new ConnectionSelectionState(
    () => options,
    () => factoryProviders,
  );
});

test.each([
  { name: 'no factory', factories: [], picked: undefined, expected: undefined },
  { name: 'the only factory', factories: [milvus], picked: undefined, expected: milvus },
  {
    name: 'no factory when several exist and none is picked',
    factories: [milvus, other],
    picked: undefined,
    expected: undefined,
  },
  { name: 'the picked factory', factories: [milvus, other], picked: 'other-internal', expected: other },
  {
    name: 'no factory when the picked one is gone',
    factories: [milvus],
    picked: 'other-internal',
    expected: undefined,
  },
])('activeFactoryProvider is $name', ({ factories, picked, expected }) => {
  factoryProviders = factories;
  if (picked) selection.selectFactoryProvider(picked);

  expect(selection.activeFactoryProvider).toEqual(expected);
});

test('auto-selects the first connection from the factory that did not exist when the creation started', () => {
  factoryProviders = [milvus];
  options = [buildOption('milvus', 'existing')];

  selection.startCreation();
  options = [buildOption('other', 'unrelated'), buildOption('milvus', 'existing'), buildOption('milvus', 'created')];

  expect(selection.selectedKey).toBe('milvus:created');
  expect(selection.formVisible).toBe(false);
});

test('keeps the form open and selects nothing while no new connection from the factory exists', () => {
  factoryProviders = [milvus];
  options = [buildOption('milvus', 'existing')];

  selection.startCreation();

  expect(selection.selectedKey).toBe('');
  expect(selection.formVisible).toBe(true);
});

test('does not auto-select when no factory is active during a creation', () => {
  factoryProviders = [milvus, other];

  selection.startCreation();
  options = [buildOption('milvus', 'created')];

  expect(selection.selectedKey).toBe('');
});

test('clears the selection when the inline-created connection disappears', () => {
  factoryProviders = [milvus];
  selection.startCreation();
  options = [buildOption('milvus', 'created')];
  expect(selection.selectedKey).toBe('milvus:created');

  options = [];

  expect(selection.selectedKey).toBe('');
});

test('a tile click replaces the inline-created connection', () => {
  factoryProviders = [milvus];
  options = [buildOption('milvus', 'existing')];
  selection.startCreation();
  options = [buildOption('milvus', 'existing'), buildOption('milvus', 'created')];
  expect(selection.selectedKey).toBe('milvus:created');

  selection.select('milvus:existing');

  expect(selection.selectedKey).toBe('milvus:existing');
});

test('openCreateForm clears the selection, shows the form and bumps the attempt', () => {
  factoryProviders = [milvus];
  options = [buildOption('milvus', 'existing')];
  selection.select('milvus:existing');

  selection.openCreateForm();

  expect(selection.selectedKey).toBe('');
  expect(selection.formVisible).toBe(true);
  expect(selection.creationAttempt).toBe(1);
});

test('keeps the inline-created connection selected when the factory registers another one later', () => {
  factoryProviders = [milvus];
  selection.startCreation();
  options = [buildOption('milvus', 'created')];
  expect(selection.selectedKey).toBe('milvus:created');

  // Providers keep connections in registration order, so a later one is listed after.
  options = [buildOption('milvus', 'created'), buildOption('milvus', 'later')];

  expect(selection.selectedKey).toBe('milvus:created');
});

test('reopens the form when the inline-created connection is removed and selects the next one from the factory', () => {
  factoryProviders = [milvus];
  selection.startCreation();
  options = [buildOption('milvus', 'created')];

  options = [];
  expect(selection.formVisible).toBe(true);

  options = [buildOption('milvus', 'next')];

  expect(selection.selectedKey).toBe('milvus:next');
});

test('ignores factory switches while an inline creation is pending', () => {
  factoryProviders = [milvus, other];
  selection.selectFactoryProvider('milvus-internal');
  selection.startCreation();

  selection.selectFactoryProvider('other-internal');
  options = [buildOption('milvus', 'created')];

  expect(selection.activeFactoryProvider).toEqual(milvus);
  expect(selection.selectedKey).toBe('milvus:created');
});
