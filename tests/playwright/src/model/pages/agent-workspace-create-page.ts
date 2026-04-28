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

import { BasePage } from './base-page';

export class AgentWorkspaceCreatePage extends BasePage {
  readonly heading: Locator;
  readonly sessionNameInput: Locator;
  readonly workingDirInput: Locator;
  readonly browseButton: Locator;
  readonly descriptionInput: Locator;
  readonly agentSelector: Locator;
  readonly fileAccessSelector: Locator;
  readonly cancelButton: Locator;
  readonly submitButton: Locator;
  readonly customPathsContainer: Locator;
  readonly addPathButton: Locator;
  readonly skillsSection: Locator;
  readonly skillsSearchInput: Locator;
  readonly mcpServersSection: Locator;
  readonly mcpServersSearchInput: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { name: 'Create Coding Agent Workspace' });
    this.sessionNameInput = this.page.getByPlaceholder('e.g., Frontend Refactoring');
    this.workingDirInput = this.page.getByPlaceholder('/path/to/project');
    this.browseButton = this.page.getByLabel('Browse for folder');
    this.descriptionInput = this.page.getByPlaceholder('Describe what this session will accomplish...');
    this.agentSelector = this.page.getByRole('region', { name: 'Select Coding Agent' });
    this.fileAccessSelector = this.page.getByRole('region', { name: 'Access Level' });
    this.cancelButton = this.page.getByRole('button', { name: 'Cancel' });
    this.submitButton = this.page.getByText('Start Workspace').or(this.page.getByText('Creating...'));
    this.customPathsContainer = this.page.getByPlaceholder('/path/to/allowed/directory').first();
    this.addPathButton = this.page.getByRole('button', { name: 'Add Another Path' });
    this.skillsSection = this.page.locator('section').filter({ hasText: 'Skills' });
    this.skillsSearchInput = this.page.getByPlaceholder('Search skills...');
    this.mcpServersSection = this.page.locator('section').filter({ hasText: 'MCP Servers' });
    this.mcpServersSearchInput = this.page.getByPlaceholder('Search MCP servers...');
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: TIMEOUTS.SHORT });
  }

  async fillSessionName(name: string): Promise<void> {
    await this.sessionNameInput.fill(name);
  }

  async fillWorkingDir(dir: string): Promise<void> {
    await this.workingDirInput.fill(dir);
  }

  async fillDescription(desc: string): Promise<void> {
    await this.descriptionInput.fill(desc);
  }

  getAgentCard(name: string): Locator {
    return this.agentSelector.getByLabel(name);
  }

  async selectAgent(name: string): Promise<void> {
    await this.getAgentCard(name).click();
  }

  async expectAgentSelected(name: string): Promise<void> {
    await expect(this.getAgentCard(name)).toHaveAttribute('aria-pressed', 'true');
  }

  async selectFileAccess(level: string): Promise<void> {
    await this.fileAccessSelector.getByLabel(level).click();
  }

  async cancel(): Promise<void> {
    await expect(this.cancelButton).toBeEnabled();
    await this.cancelButton.click();
  }
}
