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

import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test';
import { TIMEOUTS } from 'src/model/core/types';
import { handleDialogIfPresent } from 'src/utils/app-ready';

import { BaseTablePage } from './base-table-page';
import { SkillsCreatePage } from './skills-create-page';
import { SkillsDetailsPage } from './skills-details-page';

export class SkillsPage extends BaseTablePage {
  readonly header: Locator;
  readonly heading: Locator;
  readonly additionalActionsButtonGroup: Locator;
  readonly newSkillButton: Locator;
  readonly newSkillButtonFromContentRegion: Locator;
  readonly noSkillsMessage: Locator;
  readonly filteredEmptyMessage: Locator;
  readonly clearFilterButton: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    super(page, 'skills');
    this.header = this.page.getByRole('region', { name: 'header' });
    this.heading = this.header.getByRole('heading', { name: 'Skills' });
    this.additionalActionsButtonGroup = this.header.getByRole('group', { name: 'additionalActions' });
    this.newSkillButton = this.additionalActionsButtonGroup.getByRole('button', { name: 'New skill' });
    this.newSkillButtonFromContentRegion = this.content.getByRole('button', { name: 'New skill' });
    this.noSkillsMessage = this.content.getByRole('heading', { name: 'No skills' });
    this.filteredEmptyMessage = this.content.getByRole('heading', { name: /No skills matching/ });
    this.clearFilterButton = this.content.getByRole('button', { name: 'Clear filter' });
    this.searchInput = this.page.getByLabel('search Skills');
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: TIMEOUTS.SHORT });
  }

  async checkIfSkillsPageIsEmpty(): Promise<boolean> {
    await this.waitForLoad();
    return (await this.noSkillsMessage.count()) > 0;
  }

  async openCreateDialog(): Promise<SkillsCreatePage> {
    await this.waitForLoad();
    await expect(this.newSkillButton).toBeEnabled();
    await this.newSkillButton.click();
    const createPage = new SkillsCreatePage(this.page);
    await createPage.waitForLoad();
    return createPage;
  }

  async openCreateDialogFromContentRegion(): Promise<SkillsCreatePage> {
    await this.waitForLoad();
    await expect(this.newSkillButtonFromContentRegion).toBeEnabled();
    await this.newSkillButtonFromContentRegion.click();
    const createPage = new SkillsCreatePage(this.page);
    await createPage.waitForLoad();
    return createPage;
  }

  async createSkill(name: string, description: string, content: string): Promise<void> {
    const createPage = await this.openCreateDialog();
    await createPage.fillForm(name, description, content);
    await createPage.create();
  }

  async importSkill(absoluteFilePath: string, electronApp: ElectronApplication): Promise<void> {
    const createPage = await this.openCreateDialog();
    await createPage.selectFile(absoluteFilePath, electronApp);
    await createPage.create();
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }

  getSkillToggle(row: Locator, enabled: boolean): Locator {
    return row.getByRole('checkbox', { name: enabled ? 'Disable skill' : 'Enable skill' });
  }

  async enableSkill(row: Locator): Promise<void> {
    await this.getSkillToggle(row, false).click();
  }

  async disableSkill(row: Locator): Promise<void> {
    await this.getSkillToggle(row, true).click();
  }

  async expectSkillEnabledState(row: Locator, enabled: boolean): Promise<void> {
    await expect(this.getSkillToggle(row, enabled)).toBeChecked({ checked: enabled });
  }

  async getSkillNames(): Promise<string[]> {
    await this.waitForLoad();
    const rows = await this.table.getByRole('row').all();
    const names = await Promise.all(rows.slice(1).map(row => row.getAttribute('aria-label')));
    return names.filter(Boolean) as string[];
  }

  async deleteSkillByName(name: string, exact = true): Promise<void> {
    await this.waitForLoad();
    const row = await this.getRowLocatorByName(name, exact);
    const deleteButton = row.getByLabel('Delete', { exact: true }).first();
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await handleDialogIfPresent(this.page);
  }

  async openSkillDetails(name: string, exact = true): Promise<SkillsDetailsPage> {
    await this.waitForLoad();
    const row = await this.getRowLocatorByName(name, exact);
    const nameButton = row.getByRole('button', { name });
    await expect(nameButton).toBeVisible();
    await nameButton.click();
    return new SkillsDetailsPage(this.page, name);
  }
}
