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

import { BaseTablePage } from './base-table-page';

export class McpInstallTabPage extends BaseTablePage {
  readonly noMcpServersAvailableHeading: Locator;
  readonly catalogRefreshingIndicator: Locator;
  readonly passwordInput: Locator;
  readonly connectButton: Locator;
  readonly cancelButton: Locator;
  readonly installFormHeading: Locator;
  readonly spawnButton: Locator;

  constructor(page: Page) {
    super(page, 'mcpServer');
    this.noMcpServersAvailableHeading = this.table.getByRole('heading', { name: 'No MCP servers available' });
    this.catalogRefreshingIndicator = this.content.getByText(/Loading catalog|Refreshing catalog/);
    this.passwordInput = this.page.getByLabel('password');
    this.connectButton = this.page.getByRole('button', { name: 'Connect' });
    this.cancelButton = this.page.getByRole('button', { name: 'Cancel' });
    this.installFormHeading = this.page.getByRole('heading', { name: /Adding/ });
    this.spawnButton = this.page.getByRole('button', { name: 'Spawn' });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.table).toBeVisible();
  }

  async waitForCatalogRefresh(timeout: number): Promise<void> {
    await this.catalogRefreshingIndicator.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    await expect(this.catalogRefreshingIndicator).not.toBeVisible({ timeout });
  }

  async verifyServerCountIncreased(initialServerCount: number, timeout = 10_000): Promise<void> {
    await this.waitForCatalogRefresh(timeout);
    await expect
      .poll(async () => await this.countRowsFromTable(), { timeout: timeout })
      .toBeGreaterThan(initialServerCount);
  }

  async verifyServerCountIsRestored(initialServerCount: number, timeout = 10_000): Promise<void> {
    await this.waitForCatalogRefresh(timeout);
    await expect.poll(async () => await this.countRowsFromTable(), { timeout: timeout }).toBe(initialServerCount);
  }

  async verifyInstallTabIsNotEmpty(timeout = 10_000): Promise<void> {
    await expect(this.noMcpServersAvailableHeading).not.toBeVisible({ timeout: timeout });
  }

  findServer(serverName: string): Locator {
    return this.table.getByRole('row').filter({ hasText: serverName });
  }

  async clickInstallRemoteServer(serverName: string): Promise<void> {
    const serverRow = this.findServer(serverName);
    const installButton = serverRow.getByRole('button', { name: 'Install Remote server' });
    await installButton.click();
  }

  async sortByColumn(columnName: string): Promise<void> {
    const columnHeader = this.table.getByRole('columnheader', { name: columnName });
    await columnHeader.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async spawnPackageServer(serverName: string): Promise<void> {
    await this.clickInstallRemoteServer(serverName);
    await expect(this.installFormHeading).toBeVisible();
    await expect(this.spawnButton).toBeEnabled();
    await this.spawnButton.click();
  }

  async installRemoteServer(serverName: string, token: string): Promise<void> {
    await this.clickInstallRemoteServer(serverName);

    await expect(this.passwordInput).toBeVisible();
    await this.fillSecret(this.passwordInput, token);

    try {
      await expect(this.connectButton).toBeEnabled();
      await this.connectButton.click();
    } finally {
      await this.passwordInput.fill('').catch(() => {});
    }
  }
}
