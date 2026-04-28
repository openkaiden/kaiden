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
import { TIMEOUTS } from 'src/model/core/types';

import { AgentWorkspaceCreatePage } from './agent-workspace-create-page';
import { BaseTablePage } from './base-table-page';

export class AgentWorkspacesPage extends BaseTablePage {
  readonly header: Locator;
  readonly heading: Locator;
  readonly additionalActionsButtonGroup: Locator;
  readonly createButton: Locator;
  readonly noWorkspacesMessage: Locator;
  readonly filteredEmptyMessage: Locator;
  readonly clearFilterButton: Locator;
  readonly searchInput: Locator;

  constructor(page: Page) {
    super(page, 'agent-workspaces');
    this.header = this.page.getByRole('region', { name: 'header' });
    this.heading = this.header.getByRole('heading', { name: 'Agentic Workspaces' });
    this.additionalActionsButtonGroup = this.header.getByRole('group', { name: 'additionalActions' });
    this.createButton = this.additionalActionsButtonGroup.getByRole('button', { name: 'Create Workspace' });
    this.noWorkspacesMessage = this.content.getByRole('heading', { name: 'No agent workspaces' });
    this.filteredEmptyMessage = this.content.getByRole('heading', { name: /No sessions matching/ });
    this.clearFilterButton = this.content.getByRole('button', { name: 'Clear filter' });
    this.searchInput = this.page.getByLabel('search Agentic Workspaces');
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: TIMEOUTS.SHORT });
  }

  async openCreatePage(): Promise<AgentWorkspaceCreatePage> {
    await this.waitForLoad();
    await expect(this.createButton).toBeEnabled();
    await this.createButton.click();
    const createPage = new AgentWorkspaceCreatePage(this.page);
    await createPage.waitForLoad();
    return createPage;
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }
}
