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

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import PreferencesConnectionCreationOrEditRendering from '/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte';
import * as configurationPropertiesStore from '/@/stores/configurationProperties';
import type { ProviderChunkProviderConnectionInfo, ProviderInfo } from '/@api/provider-info';

import RAGEnvironmentCreateModal from './RAGEnvironmentCreateModal.svelte';

vi.mock(import('/@/stores/configurationProperties'));
vi.mock(import('/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte'));

function buildProvider(overrides: Partial<ProviderInfo>): ProviderInfo {
  return {
    internalId: 'internal',
    id: 'provider',
    extensionId: 'extension',
    name: 'Provider',
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
    ragProviderConnectionCreation: false,
    ragProviderConnectionInitialization: false,
    chunkProviderConnectionCreation: false,
    chunkProviderConnectionInitialization: false,
    links: [],
    detectionChecks: [],
    warnings: [],
    images: {},
    installationSupport: false,
    cleanupSupport: false,
    ...overrides,
  };
}

function buildChunkConnection(id: string): ProviderChunkProviderConnectionInfo {
  return { id, name: id, status: 'started', connectionType: 'chunk' };
}

const ragProvider = buildProvider({
  internalId: 'milvus-internal',
  id: 'milvus',
  name: 'Milvus',
  ragConnections: [{ name: 'store-a', status: 'started', connectionType: 'rag' }],
});

function buildChunkFactory(chunkConnections: ProviderChunkProviderConnectionInfo[] = []): ProviderInfo {
  return buildProvider({
    internalId: 'docling-internal',
    id: 'docling',
    name: 'Docling',
    chunkProviderConnectionCreation: true,
    chunkProviderConnectionCreationDisplayName: 'Docling Chunk Provider',
    chunkConnections,
  });
}

function embeddingGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Embedding Model' });
}

async function fillNameAndVectorStore(): Promise<void> {
  await fireEvent.input(screen.getByLabelText('Environment Name'), { target: { value: 'my-env' } });
  await fireEvent.click(
    within(screen.getByRole('group', { name: 'Vector Store' })).getByRole('button', { name: /store-a/ }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(configurationPropertiesStore).configurationProperties = writable([]);
});

test('shows the inline embedding creation form when no embedding connections exist and one factory is available', () => {
  const chunkFactory = buildChunkFactory();
  render(RAGEnvironmentCreateModal, { providers: [chunkFactory], closeCallback: vi.fn(), onCreate: vi.fn() });

  expect(within(embeddingGroup()).getByTestId('inline-chunk-creation-form')).toBeInTheDocument();
  expect(
    within(embeddingGroup()).getByText('No embedding models available. Create one to continue.'),
  ).toBeInTheDocument();
  expect(within(embeddingGroup()).queryByTestId('chunk-factory-picker')).not.toBeInTheDocument();
  expect(PreferencesConnectionCreationOrEditRendering).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      providerInfo: chunkFactory,
      propertyScope: 'ChunkProviderConnectionFactory',
      callback: window.createChunkProviderConnection,
      disableEmptyScreen: true,
      hideCloseButton: true,
    }),
  );
});

test('does not offer embedding creation when no provider supports chunk connection creation', () => {
  const chunkProvider = buildProvider({
    id: 'other',
    name: 'Other',
    chunkConnections: [buildChunkConnection('chunk-a')],
  });
  render(RAGEnvironmentCreateModal, { providers: [chunkProvider], closeCallback: vi.fn(), onCreate: vi.fn() });

  expect(
    within(embeddingGroup()).queryByRole('button', { name: 'Create new embedding model' }),
  ).not.toBeInTheDocument();
  expect(within(embeddingGroup()).queryByTestId('inline-chunk-creation-form')).not.toBeInTheDocument();
  expect(within(embeddingGroup()).queryByText(/No embedding models available/)).not.toBeInTheDocument();
  expect(within(embeddingGroup()).getByRole('button', { name: /chunk-a/ })).toBeInTheDocument();
});

test('shows the create new card alongside existing embedding connections and opens the form on click', async () => {
  render(RAGEnvironmentCreateModal, {
    providers: [buildChunkFactory([buildChunkConnection('chunk-a')])],
    closeCallback: vi.fn(),
    onCreate: vi.fn(),
  });

  const createNew = within(embeddingGroup()).getByRole('button', { name: 'Create new embedding model' });
  expect(within(embeddingGroup()).queryByTestId('inline-chunk-creation-form')).not.toBeInTheDocument();

  await fireEvent.click(createNew);

  expect(within(embeddingGroup()).getByTestId('inline-chunk-creation-form')).toBeInTheDocument();
});

test('selecting an existing embedding connection closes the inline form', async () => {
  render(RAGEnvironmentCreateModal, {
    providers: [buildChunkFactory([buildChunkConnection('chunk-a')])],
    closeCallback: vi.fn(),
    onCreate: vi.fn(),
  });

  await fireEvent.click(within(embeddingGroup()).getByRole('button', { name: 'Create new embedding model' }));
  await fireEvent.click(within(embeddingGroup()).getByRole('button', { name: /chunk-a/ }));

  expect(within(embeddingGroup()).queryByTestId('inline-chunk-creation-form')).not.toBeInTheDocument();
});

test('lets the user pick a factory when several support chunk connection creation', async () => {
  const doclingFactory = buildChunkFactory();
  const otherFactory = buildProvider({
    internalId: 'other-internal',
    id: 'other',
    name: 'Other',
    chunkProviderConnectionCreation: true,
  });
  render(RAGEnvironmentCreateModal, {
    providers: [doclingFactory, otherFactory],
    closeCallback: vi.fn(),
    onCreate: vi.fn(),
  });

  expect(within(embeddingGroup()).getByTestId('chunk-factory-picker')).toBeInTheDocument();
  expect(within(embeddingGroup()).queryByTestId('inline-chunk-creation-form')).not.toBeInTheDocument();

  await fireEvent.click(within(embeddingGroup()).getByRole('button', { name: 'Select Other' }));

  expect(within(embeddingGroup()).getByTestId('inline-chunk-creation-form')).toBeInTheDocument();
  expect(PreferencesConnectionCreationOrEditRendering).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ providerInfo: otherFactory, propertyScope: 'ChunkProviderConnectionFactory' }),
  );
  expect(within(embeddingGroup()).getByRole('button', { name: 'Select Docling Chunk Provider' })).toBeInTheDocument();
});

test('auto-selects a newly created embedding connection and closes the inline form', async () => {
  const onCreate = vi.fn();
  const { rerender } = render(RAGEnvironmentCreateModal, {
    providers: [ragProvider, buildChunkFactory()],
    closeCallback: vi.fn(),
    onCreate,
  });
  await fillNameAndVectorStore();
  const createButton = screen.getByRole('button', { name: 'Create Environment' });
  expect(createButton).toBeDisabled();

  await rerender({ providers: [ragProvider, buildChunkFactory([buildChunkConnection('chunk-new')])] });

  expect(within(embeddingGroup()).queryByTestId('inline-chunk-creation-form')).not.toBeInTheDocument();
  expect(createButton).toBeEnabled();

  await fireEvent.click(createButton);

  expect(onCreate).toHaveBeenCalledWith(
    'my-env',
    { name: 'store-a', providerId: 'milvus' },
    { id: 'chunk-new', providerId: 'docling' },
  );
});

test('clears the embedding selection when the selected connection disappears', async () => {
  const chunkA = buildChunkConnection('chunk-a');
  const chunkB = buildChunkConnection('chunk-b');
  const otherProvider = (chunkConnections: ProviderChunkProviderConnectionInfo[]): ProviderInfo =>
    buildProvider({ internalId: 'other-internal', id: 'other', name: 'Other', chunkConnections });
  const { rerender } = render(RAGEnvironmentCreateModal, {
    providers: [ragProvider, buildChunkFactory(), otherProvider([chunkA, chunkB])],
    closeCallback: vi.fn(),
    onCreate: vi.fn(),
  });
  await fillNameAndVectorStore();
  await fireEvent.click(within(embeddingGroup()).getByRole('button', { name: /chunk-a/ }));
  const createButton = screen.getByRole('button', { name: 'Create Environment' });
  expect(createButton).toBeEnabled();

  await rerender({ providers: [ragProvider, buildChunkFactory(), otherProvider([chunkB])] });
  expect(createButton).toBeDisabled();

  // chunk-a comes back from a provider that is not the active factory, so it must not be re-selected
  await rerender({ providers: [ragProvider, buildChunkFactory(), otherProvider([chunkB, chunkA])] });
  expect(createButton).toBeDisabled();
});
