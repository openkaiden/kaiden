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

import type { Locator, Page } from '@playwright/test';

export class AgentSessionSidebar {
  readonly page: Page;
  readonly root: Locator;
  readonly newSessionButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('acp-session-sidebar');
    this.newSessionButton = this.root.getByTitle('New Session', { exact: true });
  }

  getSessionRow(nameOrPromptSnippet: string): Locator {
    return this.root.locator('div.group').filter({ hasText: nameOrPromptSnippet });
  }

  async openSession(nameOrPromptSnippet: string): Promise<void> {
    await this.getSessionRow(nameOrPromptSnippet).getByRole('button').first().click();
  }

  async deleteSession(nameOrPromptSnippet: string): Promise<void> {
    await this.getSessionRow(nameOrPromptSnippet).getByTitle('Delete session').click();
  }

  async renameSession(nameOrPromptSnippet: string, newName: string): Promise<void> {
    const row = this.getSessionRow(nameOrPromptSnippet);
    await row.getByTitle('Rename session').click();
    const input = this.root.getByLabel('Rename session');
    await input.fill(newName);
    await input.press('Enter');
  }
}
