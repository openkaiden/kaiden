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

import { TIMEOUTS } from '/@/model/core/types';

import { BasePage } from './base-page';

export class SettingsModelsPage extends BasePage {
  readonly modelsRegion: Locator;
  readonly searchInput: Locator;
  readonly categoryNav: Locator;

  constructor(page: Page) {
    super(page);
    this.modelsRegion = page.getByRole('region', { name: 'Models' });
    this.searchInput = this.modelsRegion.getByRole('textbox', { name: 'search Models' });
    this.categoryNav = page.getByRole('navigation', { name: 'Model categories' });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.modelsRegion).toBeVisible({ timeout: TIMEOUTS.PAGE_LOAD });
  }

  getCategoryButton(label: string): Locator {
    return this.categoryNav.getByText(label, { exact: true });
  }

  async selectCategory(label: string): Promise<void> {
    const button = this.getCategoryButton(label);
    await expect(button).toBeVisible();
    await button.click();
  }

  async searchModels(query: string): Promise<void> {
    await expect(this.searchInput).toBeVisible();
    await this.searchInput.fill(query);
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.fill('');
  }

  /**
   * Returns the number of data rows in the currently visible models table.
   * Header rows are excluded by matching only rows inside cells with model-like text.
   */
  async getModelRowCount(): Promise<number> {
    // The table uses role="table" with kind="models"; data rows have role="row"
    // inside the table body. The header row also has role="row", so we count
    // all rows and subtract 1 for the header.
    const table = this.page.getByRole('table');
    const isTableVisible = await table
      .first()
      .isVisible()
      .catch(() => false);
    if (!isTableVisible) {
      return 0;
    }
    const rows = table.first().getByRole('row');
    const rowCount = await rows.count();
    // Subtract the header row
    return Math.max(0, rowCount - 1);
  }

  /**
   * Returns visible model labels from the table rows. Each model row
   * renders its label in the "Name" column.
   */
  async getModelLabels(): Promise<string[]> {
    const table = this.page.getByRole('table');
    const isTableVisible = await table
      .first()
      .isVisible()
      .catch(() => false);
    if (!isTableVisible) {
      return [];
    }
    const rows = table.first().getByRole('row');
    const count = await rows.count();
    const labels: string[] = [];
    // Skip index 0 (header row); each data row's cells include the Name column
    for (let i = 1; i < count; i++) {
      const cells = rows.nth(i).getByRole('cell');
      // Name is the second column (index 1)
      const nameCell = cells.nth(1);
      const text = await nameCell.textContent();
      if (text) {
        labels.push(text.trim());
      }
    }
    return labels;
  }
}
