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

import { configurationProperties } from './configurationProperties';
import { disabledModels, isModelEnabled, modelKey, toggleModel } from './model-catalog';

const getConfigurationValueMock = vi.fn();
const updateConfigurationValueMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'getConfigurationValue', { value: getConfigurationValueMock });
  Object.defineProperty(window, 'updateConfigurationValue', { value: updateConfigurationValueMock });
  updateConfigurationValueMock.mockResolvedValue(undefined);
  disabledModels.set(new Set());
});

test('modelKey joins providerId and label with double colon', () => {
  expect(modelKey('gemini', 'gemini-2.5-flash')).toBe('gemini::gemini-2.5-flash');
});

test('toggleModel adds then removes model from disabled set', () => {
  toggleModel('prov', 'model');
  expect(get(disabledModels).has('prov::model')).toBe(true);
  expect(updateConfigurationValueMock).toHaveBeenCalledWith('modelCatalog.disabledModels', ['prov::model']);

  toggleModel('prov', 'model');
  expect(get(disabledModels).has('prov::model')).toBe(false);
});

test('isModelEnabled checks disabled set', () => {
  expect(isModelEnabled(new Set(), 'p', 'm')).toBe(true);
  expect(isModelEnabled(new Set(['p::m']), 'p', 'm')).toBe(false);
});

test('loads disabled models from configuration on configurationProperties change', async () => {
  getConfigurationValueMock.mockResolvedValue(['provA::modelX']);

  configurationProperties.set([]);

  await vi.waitFor(() => expect(get(disabledModels).has('provA::modelX')).toBe(true));
});

test('migrates legacy single-colon keys to double-colon format', async () => {
  getConfigurationValueMock.mockResolvedValue(['provA:modelX', 'provB::modelY']);

  configurationProperties.set([]);

  await vi.waitFor(() => {
    expect(get(disabledModels).has('provA::modelX')).toBe(true);
    expect(get(disabledModels).has('provB::modelY')).toBe(true);
  });
  expect(updateConfigurationValueMock).toHaveBeenCalledWith('modelCatalog.disabledModels', [
    'provA::modelX',
    'provB::modelY',
  ]);
});
