/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { builtInExtensions, ExtensionStatus } from '/@/model/core/types';
import { AgentSessionsPage } from '/@/model/pages/agent-sessions-page';
import { AgentWorkspacesPage } from '/@/model/pages/agent-workspaces-page';
import type { BasePage } from '/@/model/pages/base-page';
import { ExtensionsPage } from '/@/model/pages/extensions-page';
import { KnowledgePage } from '/@/model/pages/knowledge-page';
import { SettingsPage } from '/@/model/pages/settings-page';

export class NavigationBar {
  readonly page: Page;
  readonly navigationLocator: Locator;
  readonly knowledgesLink: Locator;
  readonly extensionsLink: Locator;
  readonly workspacesLink: Locator;
  readonly settingsLink: Locator;
  readonly agentsLink: Locator;
  private readonly links: Locator[];

  constructor(page: Page) {
    this.page = page;
    this.navigationLocator = this.page.getByRole('navigation', { name: 'AppNavigation' });
    this.knowledgesLink = this.navigationLocator.getByRole('link', { name: 'Knowledges', exact: true });
    this.extensionsLink = this.navigationLocator.getByRole('link', { name: 'Extensions', exact: true });
    this.workspacesLink = this.navigationLocator.getByRole('link', { name: 'Workspaces', exact: true });
    this.settingsLink = this.navigationLocator.getByRole('link', { name: 'Settings', exact: true });
    this.agentsLink = this.navigationLocator.getByRole('link', { name: 'Agents', exact: true });
    // Knowledges link is conditionally hidden when no RAG/chunk providers exist,
    // so it is excluded from the always-visible links list.
    this.links = [this.extensionsLink, this.agentsLink, this.workspacesLink, this.settingsLink];
  }

  getAllLinks(): Locator[] {
    return this.links;
  }

  private async navigateTo<T extends BasePage>(link: Locator, PageClass: new (page: Page) => T): Promise<T> {
    await expect(link).toBeVisible();
    await link.click();

    const pageInstance = new PageClass(this.page);
    await pageInstance.waitForLoad();
    return pageInstance;
  }

  async navigateToKnowledgePage(): Promise<KnowledgePage> {
    // Knowledges link may be hidden when no RAG/chunk providers are registered.
    // Fall back to the application's navigation event when the link is not visible.
    if (await this.knowledgesLink.isVisible().catch(() => false)) {
      return this.navigateTo(this.knowledgesLink, KnowledgePage);
    }
    await this.page.evaluate(() => {
      const events = (window as unknown as { events: { send(channel: string, data: unknown): void } }).events;
      events.send('navigate', { page: 'rag-environments' });
    });
    const pageInstance = new KnowledgePage(this.page);
    await pageInstance.waitForLoad();
    return pageInstance;
  }

  async navigateToExtensionsPage(): Promise<ExtensionsPage> {
    return this.navigateTo(this.extensionsLink, ExtensionsPage);
  }

  async ensureExtensionsRunning(): Promise<void> {
    const extensionsPage = await (await this.navigateToExtensionsPage()).openInstalledTab();
    for (const extension of builtInExtensions) {
      if ((await extensionsPage.getExtensionState(extension.locator)) !== ExtensionStatus.RUNNING) {
        await extensionsPage.startExtensionAndVerify(extension.locator);
      }
    }
  }

  async navigateToWorkspacesPage(): Promise<AgentWorkspacesPage> {
    return this.navigateTo(this.workspacesLink, AgentWorkspacesPage);
  }

  async navigateToAgentsPage(): Promise<AgentSessionsPage> {
    return this.navigateTo(this.agentsLink, AgentSessionsPage);
  }

  async navigateToSettingsPage(): Promise<SettingsPage> {
    const settingsPage = new SettingsPage(this.page);
    // Settings nav link is a toggle: clicking while on Settings exits it
    if (!(await settingsPage.isCurrentPage())) {
      await expect(this.settingsLink).toBeVisible();
      await this.settingsLink.click();
    }
    await settingsPage.waitForLoad();
    return settingsPage;
  }
}
