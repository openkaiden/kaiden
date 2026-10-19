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

import ModelsCatalogEmptyScreen from './ModelsCatalogEmptyScreen.svelte';

test('should render the "No models" title', () => {
  render(ModelsCatalogEmptyScreen);

  expect(screen.getByText('No models')).toBeInTheDocument();
});

test('should render guidance text', () => {
  render(ModelsCatalogEmptyScreen);

  expect(
    screen.getByText('No inference providers are connected. Install an LLM provider extension to get started.'),
  ).toBeInTheDocument();
});
