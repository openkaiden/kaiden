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
import { expect, test } from 'vitest';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';

import ModelSelectionTable from './ModelSelectionTable.svelte';

const acmeModel: CatalogModelInfo = {
  providerId: 'openai-compatible',
  connectionId: 'conn-1',
  connectionName: 'Acme Gateway',
  type: 'cloud',
  label: 'acme-chat',
  connectionStatus: 'started',
  providerName: 'Acme LLM',
};

const geminiModel: CatalogModelInfo = {
  providerId: 'gemini',
  connectionId: 'conn-2',
  connectionName: 'Gemini',
  type: 'cloud',
  label: 'gemini-2.5-pro',
  connectionStatus: 'started',
  providerName: 'Gemini',
};

test('should display all models when the search is empty', () => {
  render(ModelSelectionTable, { models: [acmeModel, geminiModel] });

  expect(screen.getByText('acme-chat')).toBeInTheDocument();
  expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
});

test('should match a model on its provider id', async () => {
  render(ModelSelectionTable, { models: [acmeModel, geminiModel] });

  const searchInput = screen.getByRole('searchbox', { name: 'Filter catalog models' });
  await fireEvent.input(searchInput, { target: { value: 'openai compatible' } });

  expect(screen.getByText('acme-chat')).toBeInTheDocument();
  expect(screen.queryByText('gemini-2.5-pro')).not.toBeInTheDocument();
});
