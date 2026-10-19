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
import type { InferenceConnectionSummary } from '/@api/model-registry-info';

const windowEvents = [
  'inference-connection-summary-registry:update',
  'extension-started',
  'extension-stopped',
  'extensions-started',
];

const windowListeners = ['system-ready'];

export async function checkForUpdate(): Promise<boolean> {
  return true;
}

export const inferenceConnectionSummariesData: Writable<Readonly<InferenceConnectionSummary[]>> = writable([]);

export async function fetchInferenceConnectionSummaries(): Promise<Readonly<InferenceConnectionSummary[]>> {
  const result = await window.getInferenceConnectionSummaries();
  inferenceConnectionSummariesData.set(result);
  return result;
}

export const inferenceConnectionSummariesEventStore = new EventStore<Readonly<InferenceConnectionSummary[]>>(
  'inference-connection-summaries',
  inferenceConnectionSummariesData,
  checkForUpdate,
  windowEvents,
  windowListeners,
  fetchInferenceConnectionSummaries,
);
inferenceConnectionSummariesEventStore.setup();

export const connectionSummaries = derived(inferenceConnectionSummariesData, $data => $data);

export const cloudConnectionSummaries = derived(inferenceConnectionSummariesData, $data =>
  $data.filter(c => c.connectionType === 'cloud'),
);

export const inHouseConnectionSummaries = derived(inferenceConnectionSummariesData, $data =>
  $data.filter(c => c.connectionType === 'self-hosted'),
);

export const localConnectionSummaries = derived(inferenceConnectionSummariesData, $data =>
  $data.filter(c => c.connectionType === 'local'),
);
