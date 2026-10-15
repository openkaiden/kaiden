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

import { AgentSessionCreateDialog } from './agent-session-create-dialog';
import { AgentSessionSidebar } from './agent-session-sidebar';
import { BasePage } from './base-page';

export class AgentSessionsPage extends BasePage {
  readonly content: Locator;
  readonly header: Locator;
  readonly heading: Locator;
  readonly additionalActionsButtonGroup: Locator;
  readonly createButton: Locator;
  readonly searchInput: Locator;
  readonly noReadySandboxesMessage: Locator;
  readonly filteredEmptyMessage: Locator;
  readonly clearFilterButton: Locator;
  readonly sidebar: AgentSessionSidebar;

  constructor(page: Page) {
    super(page);
    this.content = this.page.getByRole('region', { name: 'content' });
    this.header = this.page.getByRole('region', { name: 'header' });
    this.heading = this.header.getByRole('heading', { name: 'Agents' });
    this.additionalActionsButtonGroup = this.header.getByRole('group', { name: 'additionalActions' });
    this.createButton = this.additionalActionsButtonGroup.getByRole('button', { name: 'New Session' });
    this.searchInput = this.page.getByLabel('search Agent Sessions');
    this.noReadySandboxesMessage = this.content.getByRole('heading', { name: 'No ready sandboxes' });
    this.filteredEmptyMessage = this.content.getByRole('heading', { name: /No sessions matching/ });
    this.clearFilterButton = this.content.getByRole('button', { name: 'Clear filter' });
    this.sidebar = new AgentSessionSidebar(page);
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: TIMEOUTS.SHORT });
  }

  async openCreateDialog(): Promise<AgentSessionCreateDialog> {
    await expect(this.createButton).toBeEnabled();
    await this.createButton.click();
    const dialog = new AgentSessionCreateDialog(this.page);
    await dialog.waitForLoad();
    return dialog;
  }

  getSessionRowByText(text: string): Locator {
    return this.content.getByRole('row').filter({ hasText: text });
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }
}
