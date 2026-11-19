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

import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base-page';

// Category nav label -> subtitle shown in the Models header once that category is active.
const MODEL_CATEGORIES = {
  'LLM Providers': 'API keys for hosted providers',
  'In-house': 'In-house · OpenShift AI & models',
  Local: 'Host detection & loaded models',
  'Semantic Routers': 'Intelligent request routers across multiple backends',
} as const;

export type ModelCategory = keyof typeof MODEL_CATEGORIES;

export class SettingsModelsPage extends BasePage {
  readonly modelsRegion: Locator;
  readonly searchInput: Locator;
  readonly categoryNav: Locator;
  readonly modelsTable: Locator;
  readonly filteredEmptyMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.modelsRegion = page.getByRole('region', { name: 'Models' });
    this.searchInput = this.modelsRegion.getByRole('textbox', { name: 'search Models' });
    this.categoryNav = page.getByRole('navigation', { name: 'Model categories' });
    this.modelsTable = page.getByRole('table', { name: 'models' });
    this.filteredEmptyMessage = page.getByRole('heading', { name: /No models matching/ });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.modelsRegion).toBeVisible();
  }

  async selectCategory(category: ModelCategory): Promise<void> {
    await this.categoryNav.getByRole('link', { name: category, exact: true }).click();
    await expect(this.modelsRegion.getByText(MODEL_CATEGORIES[category], { exact: true })).toBeVisible();
  }

  getModelRow(label: string): Locator {
    return this.modelsTable.getByRole('row').filter({ has: this.page.getByTitle(label, { exact: true }) });
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await expect(this.searchInput).toHaveValue(term);
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await expect(this.searchInput).toHaveValue('');
  }
}
