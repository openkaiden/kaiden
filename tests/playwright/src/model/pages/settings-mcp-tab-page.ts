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

import { TIMEOUTS } from '/@/model/core/types';

import { BasePage } from './base-page';
import { McpEditRegistriesTabPage } from './mcp-edit-registries-tab-page';
import { McpInstallTabPage } from './mcp-install-tab-page';
import { McpReadyTabPage } from './mcp-ready-tab-page';

export class SettingsMcpPage extends BasePage {
  readonly searchMcpServersField: Locator;
  readonly editRegistriesTabButton: Locator;
  readonly installTabButton: Locator;
  readonly readyTabButton: Locator;

  constructor(page: Page) {
    super(page);
    this.searchMcpServersField = page.getByLabel('search MCP servers');
    this.editRegistriesTabButton = page.getByRole('button', { name: 'Edit registries', exact: true });
    this.installTabButton = page.getByRole('button', { name: 'Install', exact: true });
    this.readyTabButton = page.getByRole('button', { name: 'Ready', exact: true });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.searchMcpServersField).toBeVisible();
  }

  async openEditRegistriesTab(): Promise<McpEditRegistriesTabPage> {
    return this.openTab(this.editRegistriesTabButton, McpEditRegistriesTabPage);
  }

  async openInstallTab(): Promise<McpInstallTabPage> {
    return this.openTab(this.installTabButton, McpInstallTabPage);
  }

  async openReadyTab(): Promise<McpReadyTabPage> {
    return this.openTab(this.readyTabButton, McpReadyTabPage);
  }

  async createServer(serverName: string, token: string): Promise<void> {
    const readyTab = await this.openReadyTab();

    if (await readyTab.isServerConnected(serverName)) {
      console.log(`MCP server ${serverName} is already connected, skipping...`);
      return;
    }

    const installTab = await this.openInstallTab();
    await installTab.installRemoteServer(serverName, token);

    const readyTabAfterInstall = await this.openReadyTab();
    await expect
      .poll(async () => await readyTabAfterInstall.isServerConnected(serverName), { timeout: TIMEOUTS.SHORT })
      .toBeTruthy();
  }

  async searchServers(query: string): Promise<void> {
    await this.searchMcpServersField.fill(query);
  }

  async clearSearch(): Promise<void> {
    await this.searchMcpServersField.clear();
  }

  async deleteServer(serverName: string): Promise<void> {
    const readyTab = await this.openReadyTab();
    await readyTab.deleteServer(serverName);
    await expect
      .poll(async () => await readyTab.isServerConnected(serverName), { timeout: TIMEOUTS.SHORT })
      .toBeFalsy();
  }
}
