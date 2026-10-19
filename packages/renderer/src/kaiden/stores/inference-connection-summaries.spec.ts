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

import type { InferenceConnectionSummary } from '/@api/model-registry-info';

import {
  cloudConnectionSummaries,
  connectionSummaries,
  fetchInferenceConnectionSummaries,
  inferenceConnectionSummariesData,
  inHouseConnectionSummaries,
  localConnectionSummaries,
} from './inference-connection-summaries';

const getInferenceConnectionSummariesMock = vi.fn<() => Promise<InferenceConnectionSummary[]>>();

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'getInferenceConnectionSummaries', {
    value: getInferenceConnectionSummariesMock,
  });
  inferenceConnectionSummariesData.set([]);
});

test('fetchInferenceConnectionSummaries calls window.getInferenceConnectionSummaries and updates store', async () => {
  const data: InferenceConnectionSummary[] = [
    { connectionType: 'cloud', providerId: 'a' } as InferenceConnectionSummary,
  ];
  getInferenceConnectionSummariesMock.mockResolvedValue(data);

  await fetchInferenceConnectionSummaries();

  expect(getInferenceConnectionSummariesMock).toHaveBeenCalled();
  expect(get(connectionSummaries)).toHaveLength(1);
});

test('type-filtered connection summary stores filter correctly', () => {
  inferenceConnectionSummariesData.set([
    { connectionType: 'cloud', providerId: 'a' },
    { connectionType: 'self-hosted', providerId: 'b' },
    { connectionType: 'local', providerId: 'c' },
  ] as InferenceConnectionSummary[]);

  expect(get(connectionSummaries)).toHaveLength(3);
  expect(get(cloudConnectionSummaries)).toHaveLength(1);
  expect(get(inHouseConnectionSummaries)).toHaveLength(1);
  expect(get(localConnectionSummaries)).toHaveLength(1);
  expect(get(cloudConnectionSummaries)[0].providerId).toBe('a');
});
