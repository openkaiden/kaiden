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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { writable } from 'svelte/store';
import { assert, beforeEach, expect, test, vi } from 'vitest';

import PreferencesConnectionCreationOrEditRendering from '/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte';
import * as configurationPropertiesStore from '/@/stores/configurationProperties';
import type { ProviderInfo } from '/@api/provider-info';

import { type ConnectionOption, ConnectionSelectionState } from './connection-selection-state.svelte';
import ConnectionSelection from './ConnectionSelection.svelte';

vi.mock(import('/@/stores/configurationProperties'));
vi.mock(import('/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte'));

function buildProvider(id: string, name: string): ProviderInfo {
  return {
    internalId: `${id}-internal`,
    id,
    extensionId: 'extension',
    name,
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

const milvus = buildProvider('milvus', 'Milvus');
const other = buildProvider('other', 'Other');

let options = $state<ConnectionOption[]>([]);
let factoryProviders = $state<ProviderInfo[]>([]);
let selection: ConnectionSelectionState;

function renderSelection(initialOptions: ConnectionOption[], initialFactoryProviders: ProviderInfo[]): void {
  options = initialOptions;
  factoryProviders = initialFactoryProviders;
  selection = new ConnectionSelectionState(
    () => options,
    () => factoryProviders,
  );
  render(ConnectionSelection, {
    label: 'Vector Store',
    selection,
    propertyScope: 'RagProviderConnectionFactory',
    createCallback: window.createRagProviderConnection,
    factoryDisplayName: (provider: ProviderInfo): string => provider.name,
    createNewAriaLabel: 'Create new vector store',
    factoryPickerTestId: 'rag-factory-picker',
    inlineFormTestId: 'inline-rag-creation-form',
    emptyMessage: 'No vector stores available. Create one to continue.',
    noProvidersMessage: 'No vector store providers installed.',
  });
}

function setOptions(newOptions: ConnectionOption[]): void {
  options = newOptions;
  flushSync();
}

async function submitInlineForm(): Promise<void> {
  const props = vi.mocked(PreferencesConnectionCreationOrEditRendering).mock.lastCall?.[1];
  assert(props);
  await props.callback('milvus-internal', {}, Symbol('key'), vi.fn(), undefined, undefined);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(configurationPropertiesStore).configurationProperties = writable([]);
  vi.mocked(window.createRagProviderConnection).mockResolvedValue(undefined);
});

test('shows the inline form with the scope when no connections exist and one factory is available', () => {
  renderSelection([], [milvus]);

  expect(screen.getByTestId('inline-rag-creation-form')).toBeInTheDocument();
  expect(screen.getByText('No vector stores available. Create one to continue.')).toBeInTheDocument();
  expect(PreferencesConnectionCreationOrEditRendering).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ providerInfo: milvus, propertyScope: 'RagProviderConnectionFactory' }),
  );
});

test('forwards the inline form submission to the create callback', async () => {
  renderSelection([], [milvus]);

  await submitInlineForm();

  expect(window.createRagProviderConnection).toHaveBeenCalledWith(
    'milvus-internal',
    {},
    expect.any(Symbol),
    expect.any(Function),
    undefined,
    undefined,
  );
});

test('shows no Create new card or form when no provider can create a connection', () => {
  renderSelection([], []);

  expect(screen.queryByRole('button', { name: 'Create new vector store' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('inline-rag-creation-form')).not.toBeInTheDocument();
  expect(screen.getByText('No vector store providers installed.')).toBeInTheDocument();
});

test('factory picker switches the creation form provider', async () => {
  renderSelection([], [milvus, other]);

  expect(screen.getByTestId('rag-factory-picker')).toBeInTheDocument();
  expect(screen.queryByTestId('inline-rag-creation-form')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Select Other' }));

  expect(PreferencesConnectionCreationOrEditRendering).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ providerInfo: other }),
  );
});

test('disables the factory picker while an inline creation is pending', async () => {
  renderSelection([], [milvus, other]);
  await fireEvent.click(screen.getByRole('button', { name: 'Select Milvus' }));

  await submitInlineForm();
  flushSync();

  expect(screen.getByRole('button', { name: 'Select Milvus' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Select Other' })).toBeDisabled();
});

test('auto-selects a connection created from the inline form and collapses the form', async () => {
  renderSelection([], [milvus]);

  await submitInlineForm();
  setOptions([buildOption('milvus', 'created')]);

  expect(selection.selectedKey).toBe('milvus:created');
  expect(screen.queryByTestId('inline-rag-creation-form')).not.toBeInTheDocument();
});

test('rethrows a failed inline creation and stops tracking it as pending', async () => {
  vi.mocked(window.createRagProviderConnection).mockRejectedValue(new Error('creation failed'));
  renderSelection([], [milvus]);

  await expect(submitInlineForm()).rejects.toThrow('creation failed');
  setOptions([buildOption('milvus', 'late')]);

  expect(selection.selectedKey).toBe('');
});

test('does not auto-select a connection that appears without an inline creation', () => {
  renderSelection([], [milvus]);

  setOptions([buildOption('milvus', 'external')]);

  expect(selection.selectedKey).toBe('');
});

test('does not auto-select a connection from another provider during an inline creation', async () => {
  renderSelection([], [milvus]);

  await submitInlineForm();
  setOptions([buildOption('other', 'unrelated')]);

  expect(selection.selectedKey).toBe('');
  expect(screen.getByTestId('inline-rag-creation-form')).toBeInTheDocument();
});

test('selecting an existing tile closes the form and keeps the user choice', async () => {
  renderSelection([buildOption('milvus', 'existing')], [milvus]);

  await fireEvent.click(screen.getByRole('button', { name: 'Create new vector store' }));
  expect(screen.getByTestId('inline-rag-creation-form')).toBeInTheDocument();
  await fireEvent.click(screen.getByRole('button', { name: /existing/ }));

  expect(selection.selectedKey).toBe('milvus:existing');
  expect(screen.queryByTestId('inline-rag-creation-form')).not.toBeInTheDocument();
});

test('reopening Create new remounts a fresh form that is not in progress', async () => {
  renderSelection([buildOption('milvus', 'existing')], [milvus]);

  await fireEvent.click(screen.getByRole('button', { name: 'Create new vector store' }));
  const callsAfterFirstOpen = vi.mocked(PreferencesConnectionCreationOrEditRendering).mock.calls.length;
  await fireEvent.click(screen.getByRole('button', { name: 'Create new vector store' }));

  expect(vi.mocked(PreferencesConnectionCreationOrEditRendering).mock.calls.length).toBe(callsAfterFirstOpen + 1);
  expect(vi.mocked(PreferencesConnectionCreationOrEditRendering).mock.lastCall?.[1]).not.toHaveProperty('inProgress');
});

test('clears the selection when the selected connection disappears', async () => {
  renderSelection([buildOption('milvus', 'existing')], [milvus]);

  await fireEvent.click(screen.getByRole('button', { name: /existing/ }));
  expect(selection.selectedKey).toBe('milvus:existing');

  setOptions([]);

  expect(selection.selectedKey).toBe('');
});
