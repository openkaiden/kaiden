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

import { BasePage } from './base-page';

export class SettingsCreateGeminiPage extends BasePage {
  readonly apiKeyInput: Locator;
  readonly createButton: Locator;
  readonly goBackToResourcesButton: Locator;

  constructor(page: Page) {
    super(page);
    this.apiKeyInput = page.getByLabel('Enter your Gemini API key (GEMINI_API_KEY)');
    this.createButton = page.getByRole('button', { name: 'Create' });
    this.goBackToResourcesButton = page.getByRole('button', { name: 'Go back to resources' });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.apiKeyInput).toBeVisible();
    await expect(this.createButton).toBeVisible();
  }

  async create(apiKey: string): Promise<void> {
    await this.fillSecret(this.apiKeyInput, apiKey);
    try {
      await expect(this.createButton).toBeEnabled();
      await this.createButton.click();
    } finally {
      await this.apiKeyInput.fill('').catch(() => {});
    }
  }

  async goBackToResources(): Promise<void> {
    await expect(this.goBackToResourcesButton).toBeVisible();
    await this.goBackToResourcesButton.click();
  }

  async createAndGoBack(apiKey: string): Promise<void> {
    await this.create(apiKey);
    await this.goBackToResources();
  }
}
