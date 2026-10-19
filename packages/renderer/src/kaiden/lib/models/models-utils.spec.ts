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

import { expect, test } from 'vitest';

import type { ModelInfo } from '/@api/model-registry-info';

import { getModelId } from './models-utils';

test('getModelId builds id from llmMetadata.name, label and endpoint', () => {
  const model: ModelInfo = {
    providerId: 'p',
    connectionId: 'conn-0',
    connectionName: 'c',
    type: 'cloud',
    llmMetadata: { name: 'claude' },
    endpoint: 'https://api.example.com',
    label: 'claude-3',
  } as ModelInfo;

  expect(getModelId(model)).toBe('claude::claude-3::https://api.example.com');
});

test('getModelId handles missing llmMetadata and endpoint', () => {
  const model: ModelInfo = {
    providerId: 'p',
    connectionId: 'conn-0',
    connectionName: 'c',
    type: 'cloud',
    label: 'gpt-4',
  };

  expect(getModelId(model)).toBe('::gpt-4::');
});
