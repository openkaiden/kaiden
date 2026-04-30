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
import { SkillsPage } from './skills-page';

export class SkillsDetailsPage extends BasePage {
  readonly skillName: string;
  readonly header: Locator;
  readonly heading: Locator;
  readonly pageTabsRegion: Locator;
  readonly tabContentRegion: Locator;
  readonly summaryTabLink: Locator;
  readonly instructionsTabLink: Locator;
  readonly resourcesTabLink: Locator;
  readonly closeButton: Locator;
  readonly instructionsFilename: Locator;
  readonly instructionsContent: Locator;
  readonly resourcesHeader: Locator;

  constructor(page: Page, name: string) {
    super(page);
    this.skillName = name;
    this.header = this.page.getByRole('region', { name: 'header' });
    this.heading = this.header.getByRole('heading', { name: this.skillName });
    this.pageTabsRegion = this.page.getByRole('region', { name: 'Tabs' });
    this.tabContentRegion = this.page.getByRole('region', { name: 'Tab Content' });
    this.summaryTabLink = this.pageTabsRegion.getByRole('link', { name: 'Summary' });
    this.instructionsTabLink = this.pageTabsRegion.getByRole('link', { name: 'Instructions' });
    this.resourcesTabLink = this.pageTabsRegion.getByRole('link', { name: 'Resources' });
    this.closeButton = this.header.getByRole('button', { name: 'Close' });
    this.instructionsFilename = this.tabContentRegion.getByText('SKILL.md', { exact: true });
    this.instructionsContent = this.tabContentRegion.locator('pre');
    this.resourcesHeader = this.tabContentRegion.getByText(/Bundled Resources/);
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: 15_000 });
    await expect(this.pageTabsRegion).toBeVisible();
  }

  async switchToInstructionsTab(): Promise<void> {
    await this.switchTab(this.instructionsTabLink);
  }

  async switchToResourcesTab(): Promise<void> {
    await this.switchTab(this.resourcesTabLink);
  }

  private async switchTab(tabLink: Locator): Promise<void> {
    await expect(tabLink).toBeVisible();
    await tabLink.click();
  }

  getDetailRowValue(label: string): Locator {
    return this.tabContentRegion.getByLabel(`${label} value`);
  }

  getStatusBadge(): Locator {
    return this.header.getByLabel('Skill status');
  }

  async expectStatusEnabled(enabled: boolean): Promise<void> {
    const label = enabled ? 'Enabled' : 'Disabled';
    await expect(this.getStatusBadge()).toHaveText(label);
  }

  async closeDetailsPage(): Promise<SkillsPage> {
    await expect(this.closeButton).toBeEnabled();
    await this.closeButton.click();
    const skillsPage = new SkillsPage(this.page);
    await skillsPage.waitForLoad();
    return skillsPage;
  }
}
