/**********************************************************************
 * Copyright (C) 2024-2025 Red Hat, Inc.
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

import { providerInfos } from '/@/stores/providers';
import type { ProviderInfo } from '/@api/provider-info';

import { createNavigationRagEntry } from './navigation-registry-rag.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

test('should hide Knowledges entry when no providers exist', async () => {
  providerInfos.set([]);

  const entry = createNavigationRagEntry();

  expect(entry).toBeDefined();
  expect(entry.name).toBe('Knowledges');
  expect(entry.link).toBe('/rag-environments');
  expect(entry.tooltip).toBe('Knowledges');
  await vi.waitFor(() => {
    expect(entry.hidden).toBe(true);
  });
});

test('should hide Knowledges entry when no rag provider capability exists', async () => {
  const entry = createNavigationRagEntry();

  providerInfos.set([
    {
      ragProviderConnectionCreation: false,
      chunkProviderConnectionCreation: true,
    } as unknown as ProviderInfo,
  ]);

  await vi.waitFor(() => {
    expect(entry.hidden).toBe(true);
  });
});

test('should hide Knowledges entry when no chunk provider capability exists', async () => {
  const entry = createNavigationRagEntry();

  providerInfos.set([
    {
      ragProviderConnectionCreation: true,
      chunkProviderConnectionCreation: false,
    } as unknown as ProviderInfo,
  ]);

  await vi.waitFor(() => {
    expect(entry.hidden).toBe(true);
  });
});

test('should show Knowledges entry when both rag and chunk provider capabilities exist', async () => {
  const entry = createNavigationRagEntry();

  providerInfos.set([
    {
      ragProviderConnectionCreation: true,
      chunkProviderConnectionCreation: true,
    } as unknown as ProviderInfo,
  ]);

  await vi.waitFor(() => {
    expect(entry.hidden).toBe(false);
  });
});

test('should show Knowledges entry when rag and chunk capabilities are on different providers', async () => {
  const entry = createNavigationRagEntry();

  providerInfos.set([
    {
      ragProviderConnectionCreation: true,
      chunkProviderConnectionCreation: false,
    } as unknown as ProviderInfo,
    {
      ragProviderConnectionCreation: false,
      chunkProviderConnectionCreation: true,
    } as unknown as ProviderInfo,
  ]);

  await vi.waitFor(() => {
    expect(entry.hidden).toBe(false);
  });
});
