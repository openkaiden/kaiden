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

import { AgentWorkspacesPage } from '../pages/agent-workspaces-page';
import type { BasePage } from '../pages/base-page';
import { ChatPage } from '../pages/chat-page';
import { ExtensionsPage } from '../pages/extensions-page';
import { FlowsPage } from '../pages/flows-page';
import { KnowledgePage } from '../pages/knowledge-page';
import { McpPage } from '../pages/mcp-page';
import { SettingsPage } from '../pages/settings-page';
import { SkillsPage } from '../pages/skills-page';

export class NavigationBar {
  readonly page: Page;
  readonly navigationLocator: Locator;
  readonly chatLink: Locator;
  readonly mcpLink: Locator;
  readonly flowsLink: Locator;
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
    this.mcpLink = this.navigationLocator.getByRole('link', { name: 'MCP' });
    this.flowsLink = this.navigationLocator.getByRole('link', { name: 'Flows', exact: true });
    this.skillsLink = this.navigationLocator.getByRole('link', { name: 'Skills', exact: true });
    this.knowledgesLink = this.navigationLocator.getByRole('link', { name: 'Knowledges', exact: true });
    this.extensionsLink = this.navigationLocator.getByRole('link', { name: 'Extensions', exact: true });
    this.workspacesLink = this.navigationLocator.getByRole('link', { name: 'Workspaces', exact: true });
    this.settingsLink = this.navigationLocator.getByRole('link', { name: 'Settings', exact: true });
    this.links = [
      this.chatLink,
      this.mcpLink,
      // this.flowsLink, // Flows feature removed (PR #1319)
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

  async navigateToMCPPage(): Promise<McpPage> {
    return this.navigateTo(this.mcpLink, McpPage);
  }

  async navigateToFlowsPage(): Promise<FlowsPage> {
    return this.navigateTo(this.flowsLink, FlowsPage);
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
