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

import { derived, type Writable, writable } from 'svelte/store';

import { EventStore } from '/@/stores/event-store';
import type { CatalogModelInfo, ModelInfo } from '/@api/model-registry-info';

const windowEvents = ['model-registry:update', 'extension-started', 'extension-stopped', 'extensions-started'];

const windowListeners = ['system-ready'];

export async function checkForUpdate(): Promise<boolean> {
  return true;
}

export const catalogModelsData: Writable<Readonly<CatalogModelInfo[]>> = writable([]);

export async function fetchCatalogModels(): Promise<Readonly<CatalogModelInfo[]>> {
  const result = await window.getCatalogModels();
  catalogModelsData.set(result);
  return result;
}

export const modelRegistryEventStore = new EventStore<Readonly<CatalogModelInfo[]>>(
  'models',
  catalogModelsData,
  checkForUpdate,
  windowEvents,
  windowListeners,
  fetchCatalogModels,
);
modelRegistryEventStore.setup();

export const catalogModels = derived(catalogModelsData, $data => $data);

export const allModels = derived<Writable<Readonly<CatalogModelInfo[]>>, ModelInfo[]>(catalogModelsData, $data =>
  $data.map(({ connectionStatus: _, providerName: __, ...model }) => model),
);

export const cloudCatalogModels = derived(catalogModelsData, $data => $data.filter(m => m.type === 'cloud'));

export const inHouseCatalogModels = derived(catalogModelsData, $data => $data.filter(m => m.type === 'self-hosted'));

export const localCatalogModels = derived(catalogModelsData, $data => $data.filter(m => m.type === 'local'));
