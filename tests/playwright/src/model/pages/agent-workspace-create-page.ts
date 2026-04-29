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
import { type CodingAgent, type FileAccessLevel, TIMEOUTS, WIZARD_STEPS, type WizardStep } from 'src/model/core/types';

import { BasePage } from './base-page';

export class AgentWorkspaceCreatePage extends BasePage {
  readonly heading: Locator;

  // Step 1: Workspace
  readonly sessionNameInput: Locator;
  readonly workingDirInput: Locator;
  readonly browseButton: Locator;
  readonly descriptionToggle: Locator;
  readonly descriptionInput: Locator;

  // Step 2: Agent & Model
  readonly agentSelector: Locator;

  // Step 3: Tools & Secrets
  readonly skillsSearchInput: Locator;
  readonly mcpServersSearchInput: Locator;

  // Step 4: File System
  readonly fileAccessSelector: Locator;
  readonly firstCustomPathInput: Locator;
  readonly addPathButton: Locator;

  // Wizard
  readonly wizardStepper: Locator;
  readonly cancelButton: Locator;
  readonly continueButton: Locator;
  readonly backButton: Locator;
  readonly submitButton: Locator;
  readonly useDefaultsButton: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { name: 'Create Coding Agent Workspace' });

    this.sessionNameInput = this.page.getByPlaceholder('e.g., Frontend Refactoring');
    this.workingDirInput = this.page.getByPlaceholder('/path/to/project');
    this.browseButton = this.page.getByLabel('Browse for folder');
    this.descriptionToggle = this.page.getByRole('button', { name: /Description/ });
    this.descriptionInput = this.page.getByPlaceholder('Short note for your team (optional)');

    this.agentSelector = this.page.getByRole('region', { name: 'Select Coding Agent' });

    this.skillsSearchInput = this.page.getByPlaceholder('Search skills...');
    this.mcpServersSearchInput = this.page.getByPlaceholder('Search MCP servers...');

    this.fileAccessSelector = this.page.getByRole('region', { name: 'Access Level' });
    this.firstCustomPathInput = this.page.getByPlaceholder('/path/to/allowed/directory').first();
    this.addPathButton = this.page.getByRole('button', { name: 'Add Another Path' });

    this.wizardStepper = this.page.getByLabel('Wizard progress');
    this.cancelButton = this.page.getByRole('button', { name: 'Cancel' });
    this.continueButton = this.page.getByRole('button', { name: 'Continue' });
    this.backButton = this.page.getByRole('button', { name: 'Back', exact: true });
    this.submitButton = this.page.getByRole('button', { name: 'Start Workspace' });
    this.useDefaultsButton = this.page.getByRole('button', {
      name: 'Use all defaults and create workspace',
      exact: true,
    });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: TIMEOUTS.SHORT });
  }

  // --- Wizard navigation ---

  getStepButton(step: WizardStep): Locator {
    return this.wizardStepper.getByLabel(`${step} step`);
  }

  async expectStepActive(step: WizardStep): Promise<void> {
    await expect(this.getStepButton(step)).toHaveAttribute('aria-current', 'step');
  }

  async goToStep(step: WizardStep): Promise<void> {
    const stepButton = this.getStepButton(step);
    await expect(stepButton).toBeEnabled();
    await stepButton.click();
  }

  async goToNextStep(): Promise<void> {
    await expect(this.continueButton).toBeEnabled();
    await this.continueButton.click();
  }

  async goToPreviousStep(): Promise<void> {
    await expect(this.backButton).toBeVisible();
    await this.backButton.click();
  }

  async getCurrentStepIndex(): Promise<number> {
    for (let i = 0; i < WIZARD_STEPS.length; i++) {
      const attr = await this.getStepButton(WIZARD_STEPS[i]).getAttribute('aria-current');
      if (attr === 'step') return i;
    }
    return 0;
  }

  async navigateToStep(step: WizardStep): Promise<void> {
    const currentIndex = await this.getCurrentStepIndex();
    const targetIndex = WIZARD_STEPS.indexOf(step);
    for (let i = currentIndex; i < targetIndex; i++) {
      await this.goToNextStep();
    }
    await this.expectStepActive(step);
  }

  // --- Step 1: Workspace ---

  async fillDescription(desc: string): Promise<void> {
    if (!(await this.descriptionInput.isVisible())) {
      await this.descriptionToggle.click();
      await expect(this.descriptionInput).toBeVisible();
    }
    await this.descriptionInput.fill(desc);
  }

  // --- Step 2: Agent & Model ---

  getAgentCard(agent: CodingAgent): Locator {
    return this.agentSelector.getByLabel(agent);
  }

  async selectAgent(agent: CodingAgent): Promise<void> {
    const card = this.getAgentCard(agent);
    if ((await card.getAttribute('aria-pressed')) !== 'true') {
      await card.click();
    }
    await expect(card).toHaveAttribute('aria-pressed', 'true');
  }

  // --- Step 3: Tools & Secrets ---

  getCardByName(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  // --- Step 4: File System ---

  async selectFileAccess(level: FileAccessLevel): Promise<void> {
    await this.fileAccessSelector.getByLabel(level).click();
  }

  // --- Actions ---

  async cancel(): Promise<void> {
    await expect(this.cancelButton).toBeEnabled();
    await this.cancelButton.click();
  }

  async startWithDefaults(): Promise<void> {
    await expect(this.useDefaultsButton).toBeEnabled();
    await this.useDefaultsButton.click();
  }

  async startWorkspace(): Promise<void> {
    await expect(this.submitButton).toBeEnabled();
    await this.submitButton.click();
  }
}
