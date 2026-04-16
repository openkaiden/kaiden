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
import { type ConnectionType, featuredResources, resources, TIMEOUTS } from 'src/model/core/types';

import { BasePage } from './base-page';
import { SettingsCreateGeminiPage } from './settings-create-gemini-page';
import { SettingsCreateMilvusPage } from './settings-create-milvus-page';
import { SettingsCreateOpenAIPage } from './settings-create-openai-page';

export class SettingsResourcesPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForLoad(): Promise<void> {
    await expect(this.getResourceRegion(featuredResources[0])).toBeVisible();
  }

  getResourceRegion(resourceId: string): Locator {
    return this.page.getByRole('region', { name: 'Featured Provider Resources' }).locator(`[id="${resourceId}"]`);
  }

  getProviderRegion(providerId: string): Locator {
    return this.page.getByRole('region', { name: providerId, exact: true });
  }

  getResourceCreateButton(displayName: string): Locator {
    return this.page.getByRole('button', { name: `Create new ${displayName}` });
  }

  async openCreateGeminiPage(): Promise<SettingsCreateGeminiPage> {
    return this.openTab(this.getResourceCreateButton(resources.gemini.displayName), SettingsCreateGeminiPage);
  }

  async openCreateOpenAIPage(): Promise<SettingsCreateOpenAIPage> {
    return this.openTab(this.getResourceCreateButton(resources.openai.displayName), SettingsCreateOpenAIPage);
  }

  async openCreateMilvusPage(): Promise<SettingsCreateMilvusPage> {
    return this.openTab(
      this.getResourceCreateButton(resources.milvus.displayName),
      SettingsCreateMilvusPage,
      TIMEOUTS.DEFAULT,
    );
  }

  private getConnectionTypeLabel(connectionType: ConnectionType): string {
    switch (connectionType) {
      case 'rag':
        return '(Knowledge Database)';
      default:
        return '(Inference)';
    }
  }

  getCreatedConnectionsFor(resourceId: keyof typeof resources, connectionType: ConnectionType = 'inference'): Locator {
    const label = this.getConnectionTypeLabel(connectionType);
    return this.getProviderRegion(resourceId)
      .getByRole('region', { name: 'Provider Connections' })
      .getByRole('region')
      .filter({ hasText: label });
  }

  getCreatedConnectionFor(resourceId: keyof typeof resources, connectionType: ConnectionType = 'inference'): Locator {
    return this.getCreatedConnectionsFor(resourceId, connectionType).first();
  }

  getDeleteButtonForCreatedResource(resource: Locator): Locator {
    return resource.getByRole('button', { name: 'Delete' });
  }

  getStopButtonForCreatedResource(resource: Locator): Locator {
    return resource.getByRole('button', { name: 'Stop' });
  }

  async deleteCreatedConnectionFor(
    resourceId: keyof typeof resources,
    connectionType: ConnectionType = 'inference',
  ): Promise<void> {
    const resource = this.getCreatedConnectionFor(resourceId, connectionType);
    const stopButton = this.getStopButtonForCreatedResource(resource);
    if (await stopButton.isVisible({ timeout: TIMEOUTS.SHORT })) {
      await stopButton.click();
    }
    const deleteButton = this.getDeleteButtonForCreatedResource(resource);
    await expect(deleteButton).toBeEnabled({ timeout: TIMEOUTS.DEFAULT });
    await deleteButton.click();
  }
}
