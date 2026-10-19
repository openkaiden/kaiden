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

import { render, screen } from '@testing-library/svelte';
import { expect, test } from 'vitest';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';

import ModelRuntimeColumn from './ModelRuntimeColumn.svelte';

const model: CatalogModelInfo = {
  providerId: 'gemini',
  providerName: 'Gemini',
  connectionId: 'conn-0',
  connectionName: 'default',
  type: 'cloud',
  label: 'gemini-2.5-flash',
  connectionStatus: 'started',
};

test('should display the provider name', () => {
  render(ModelRuntimeColumn, { object: model });

  expect(screen.getByText('Gemini')).toBeInTheDocument();
});

test('should have the provider name as title attribute', () => {
  render(ModelRuntimeColumn, { object: model });

  expect(screen.getByTitle('Gemini')).toBeInTheDocument();
});
