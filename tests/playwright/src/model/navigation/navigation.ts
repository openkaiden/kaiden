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
import { AgentWorkspacesPage } from '/@/model/pages/agent-workspaces-page';
import type { BasePage } from '/@/model/pages/base-page';
import { ChatPage } from '/@/model/pages/chat-page';
import { ExtensionsPage } from '/@/model/pages/extensions-page';
import { KnowledgePage } from '/@/model/pages/knowledge-page';
import { SettingsPage } from '/@/model/pages/settings-page';
import { SkillsPage } from '/@/model/pages/skills-page';

export class NavigationBar {
  readonly page: Page;
  readonly navigationLocator: Locator;
  readonly chatLink: Locator;
  readonly skillsLink: Locator;
  readonly knowledgesLink: Locator;
  readonly extensionsLink: Locator;
  readonly workspacesLink: Locator;
  readonly settingsLink: Locator;
  private readonly links: Locator[];

  constructor(page: Page) {
    this.page = page;
    this.navigationLocator = this.page.getByRole('navigation', { name: 'AppNavigation' });
    this.chatLink = this.navigationLocator.getByRole('link', { name: 'Chat' });
    this.skillsLink = this.navigationLocator.getByRole('link', { name: 'Skills', exact: true });
    this.knowledgesLink = this.navigationLocator.getByRole('link', { name: 'Knowledges', exact: true });
    this.extensionsLink = this.navigationLocator.getByRole('link', { name: 'Extensions', exact: true });
    this.workspacesLink = this.navigationLocator.getByRole('link', { name: 'Workspaces', exact: true });
    this.settingsLink = this.navigationLocator.getByRole('link', { name: 'Settings', exact: true });
    this.links = [
      this.chatLink,
      this.skillsLink,
      this.knowledgesLink,
      this.extensionsLink,
      this.workspacesLink,
      this.settingsLink,
    ];
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

  async navigateToChatPage(): Promise<ChatPage> {
    return this.navigateTo(this.chatLink, ChatPage);
  }

  async navigateToSkillsPage(): Promise<SkillsPage> {
    return this.navigateTo(this.skillsLink, SkillsPage);
  }

  async navigateToKnowledgePage(): Promise<KnowledgePage> {
    return this.navigateTo(this.knowledgesLink, KnowledgePage);
  }

  async navigateToExtensionsPage(): Promise<ExtensionsPage> {
    return this.navigateTo(this.extensionsLink, ExtensionsPage);
  }

  async ensureChatWindowEnabled(): Promise<void> {
    if (await this.chatLink.isVisible()) {
      return;
    }
    const settingsPage = await this.navigateToSettingsPage();
    const preferencesPage = await settingsPage.openPreferences();
    await preferencesPage.enableChatWindow();
    await expect(this.chatLink).toBeVisible();
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
