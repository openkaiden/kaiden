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

import { BasePage } from './base-page';

export class AgentSessionCreateDialog extends BasePage {
  readonly dialog: Locator;
  readonly sandboxDropdownTrigger: Locator;
  readonly promptTextarea: Locator;
  readonly startSessionButton: Locator;
  readonly cancelButton: Locator;
  readonly unsupportedAgentError: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = page.getByRole('dialog', { name: 'New Agent Session' });
    this.sandboxDropdownTrigger = this.dialog.getByLabel('Sandbox');
    this.promptTextarea = this.dialog.getByLabel('Prompt');
    this.startSessionButton = this.dialog.getByRole('button', { name: 'Start Session' });
    this.cancelButton = this.dialog.getByRole('button', { name: 'Cancel' });
    this.unsupportedAgentError = this.dialog.getByText(/does not support ACP sessions/);
  }

  async waitForLoad(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: TIMEOUTS.STANDARD });
  }

  async selectSandbox(name: string): Promise<void> {
    await this.sandboxDropdownTrigger.click();
    await this.dialog.getByRole('button', { name, exact: true }).click();
  }

  async fillPrompt(text: string): Promise<void> {
    await this.promptTextarea.fill(text);
  }

  async submit(): Promise<void> {
    await expect(this.startSessionButton).toBeEnabled();
    await this.startSessionButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.STANDARD });
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.STANDARD });
  }
}
