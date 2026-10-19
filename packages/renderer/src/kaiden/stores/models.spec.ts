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

import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import type { CatalogModelInfo } from '/@api/model-registry-info';

import {
  allModels,
  catalogModels,
  catalogModelsData,
  cloudCatalogModels,
  fetchCatalogModels,
  inHouseCatalogModels,
  localCatalogModels,
} from './models';

const getCatalogModelsMock = vi.fn<() => Promise<CatalogModelInfo[]>>();

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'getCatalogModels', { value: getCatalogModelsMock });
  catalogModelsData.set([]);
});

test('fetchCatalogModels calls window.getCatalogModels and updates store', async () => {
  const data: CatalogModelInfo[] = [
    {
      providerId: 'p',
      providerName: 'Provider',
      connectionId: 'conn-0',
      connectionName: 'c',
      type: 'cloud',
      label: 'model-1',
      connectionStatus: 'started',
    } as CatalogModelInfo,
  ];
  getCatalogModelsMock.mockResolvedValue(data);

  await fetchCatalogModels();

  expect(getCatalogModelsMock).toHaveBeenCalled();
  expect(get(catalogModels)).toHaveLength(1);
  expect(get(catalogModels)[0].label).toBe('model-1');
});

test('allModels derived store strips catalog-specific fields', () => {
  catalogModelsData.set([
    {
      providerId: 'p',
      providerName: 'Provider',
      connectionId: 'conn-0',
      connectionName: 'c',
      type: 'cloud',
      label: 'model-1',
      connectionStatus: 'started',
    } as CatalogModelInfo,
  ]);

  const models = get(allModels);
  expect(models).toHaveLength(1);
  expect(models[0]).not.toHaveProperty('connectionStatus');
  expect(models[0]).not.toHaveProperty('providerName');
  expect(models[0].providerId).toBe('p');
  expect(models[0].label).toBe('model-1');
});

test('type-filtered catalog model stores filter correctly', () => {
  catalogModelsData.set([
    { type: 'cloud', label: 'cloud-model' } as CatalogModelInfo,
    { type: 'self-hosted', label: 'inhouse-model' } as CatalogModelInfo,
    { type: 'local', label: 'local-model' } as CatalogModelInfo,
    { type: 'cloud', label: 'cloud-model-2' } as CatalogModelInfo,
  ]);

  expect(get(cloudCatalogModels)).toHaveLength(2);
  expect(get(inHouseCatalogModels)).toHaveLength(1);
  expect(get(localCatalogModels)).toHaveLength(1);
  expect(get(cloudCatalogModels).map(m => m.label)).toEqual(['cloud-model', 'cloud-model-2']);
});
