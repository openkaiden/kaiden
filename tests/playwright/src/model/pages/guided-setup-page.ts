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

import {
  CODING_AGENT,
  type CodingAgent,
  SELECTORS,
  TIMEOUTS,
  type WorkspaceInferenceProviderId,
} from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

import type { ResolvedAgentModelSetup } from './agent-model-setup';
import { resolveAgentModelConnectionFor } from './agent-model-setup';
import { BasePage } from './base-page';

export class GuidedSetupPage extends BasePage {
  readonly welcomePage: Locator;
  readonly startGuidedSetupButton: Locator;
  readonly dialog: Locator;
  readonly wizardStepper: Locator;
  readonly agentSelector: Locator;
  readonly backButton: Locator;
  readonly skipButton: Locator;
  readonly continueButton: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomePage = page.locator(SELECTORS.WELCOME_PAGE).first();
    this.startGuidedSetupButton = page.getByRole('button', { name: 'Start guided setup', exact: true });
    this.dialog = page.getByRole('dialog', { name: 'Guided Setup' });
    this.wizardStepper = this.dialog.getByLabel('Wizard progress');
    this.agentSelector = this.dialog.getByRole('listbox', { name: 'Coding agent' });
    this.backButton = this.dialog.getByRole('button', { name: 'Back', exact: true });
    this.skipButton = this.dialog.getByRole('button', { name: 'Skip', exact: true });
    this.continueButton = this.dialog.getByRole('button', { name: /Go to Dashboard|Continue/ });
  }

  async waitForLoad(): Promise<void> {
    await this.expectLoaded();
  }

  async waitForWelcomeFooterReady(): Promise<void> {
    const skipButton = this.page.getByRole('button', { name: 'Skip', exact: true });
    await expect(this.startGuidedSetupButton.or(skipButton).first()).toBeEnabled({ timeout: 60_000 });
  }

  async startFromWelcome(): Promise<void> {
    await expect(this.welcomePage).toBeVisible({ timeout: TIMEOUTS.STANDARD });
    await this.waitForWelcomeFooterReady();
    await this.startGuidedSetupButton.click();
    await this.expectLoaded();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: TIMEOUTS.STANDARD });
    await expect(this.wizardStepper).toBeVisible();
    await expect(this.agentSelector).toBeVisible();
  }

  getAgentCard(agent: CodingAgent): Locator {
    return this.agentSelector.getByRole('option', { name: agent, exact: true });
  }

  get codingAgentStep(): Locator {
    return this.wizardStepper.getByLabel('Coding agent step');
  }

  async selectAgent(agent: CodingAgent): Promise<void> {
    const card = this.getAgentCard(agent);
    await expect(card).toBeVisible();
    if ((await card.getAttribute('aria-selected')) !== 'true') {
      await card.click();
    }
    await expect(card).toHaveAttribute('aria-selected', 'true');
  }

  get providerPicker(): Locator {
    return this.dialog.getByTestId('provider-picker');
  }

  get modelRows(): Locator {
    return this.dialog.locator('[data-testid^="model-row-"]');
  }

  get createConnectionPrompt(): Locator {
    return this.dialog.getByTestId('no-models-create-connection');
  }

  getModelRow(modelLabel: string): Locator {
    return this.dialog.getByTestId(`model-row-${modelLabel}`);
  }

  async waitForModelCatalog(timeout: number = TIMEOUTS.DEFAULT): Promise<void> {
    await expect
      .poll(async () => await this.modelRows.count(), {
        timeout,
        intervals: [500, 1_000, 2_000],
        message: 'Model catalog did not populate in guided setup',
      })
      .toBeGreaterThan(0);
  }

  async getModelLabels(): Promise<string[]> {
    const rows = this.modelRows;
    const count = await rows.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const testId = await rows.nth(i).getAttribute('data-testid');
      if (testId?.startsWith('model-row-')) {
        labels.push(testId.slice('model-row-'.length));
      }
    }
    return labels;
  }

  async selectModelByLabel(modelLabel: string): Promise<void> {
    const row = this.getModelRow(modelLabel);
    await expect(row).toBeVisible();
    const radio = row.locator('input[name="modelSelection"]');
    await this.selectRadio(radio);
    await expect(this.dialog.getByTestId('selected-model')).toHaveText(`Selected: ${modelLabel}`);
  }

  async getSelectedModelLabel(): Promise<string> {
    const selected = this.dialog.getByTestId('selected-model');
    await expect(selected).toBeVisible();
    const text = await selected.textContent();
    return text?.replace(/^Selected:\s*/, '').trim() ?? '';
  }

  async ensureModelCatalogFor(agent: CodingAgent, preferredProviderId?: WorkspaceInferenceProviderId): Promise<void> {
    await this.selectAgent(agent);
    const setup = resolveAgentModelConnectionFor(agent, preferredProviderId);
    if (setup) {
      // Wait for the connection gate to settle — inference summaries load async.
      await expect(this.modelRows.first().or(this.createConnectionPrompt)).toBeVisible({
        timeout: TIMEOUTS.STANDARD,
      });
      if (await this.createConnectionPrompt.isVisible()) {
        await this.createInlineConnection(setup);
        expect(
          await this.modelRows.count(),
          `${setup.providerName} connection created but returned 0 models — verify the API key`,
        ).toBeGreaterThan(0);
      }
    }
    await this.waitForModelCatalog();
  }

  async completeAgentModelFor(agent: CodingAgent, preferredProviderId?: WorkspaceInferenceProviderId): Promise<string> {
    await this.ensureModelCatalogFor(agent, preferredProviderId);
    await this.selectGuidedSetupDefaultModel(agent);
    return this.getSelectedModelLabel();
  }

  async expectDefaultModelHeading(agent: CodingAgent): Promise<void> {
    await expect(this.dialog.getByText(new RegExp(`Choose the default model ${agent} should use`))).toBeVisible();
  }

  async expectBackDisabled(): Promise<void> {
    await expect(this.backButton).toBeDisabled();
  }

  async expectCodingAgentStepVisible(): Promise<void> {
    await expect(this.codingAgentStep).toBeVisible();
  }

  async isProviderPickerVisible(): Promise<boolean> {
    return this.providerPicker.isVisible();
  }

  async isProviderOptionVisible(providerName: string): Promise<boolean> {
    return this.getProviderOption(providerName).isVisible();
  }

  async isModelVisible(modelLabel: string): Promise<boolean> {
    return this.getModelRow(modelLabel).isVisible();
  }

  getProviderOption(providerName: string): Locator {
    return this.providerPicker.getByRole('button', { name: `Select ${providerName}`, exact: true });
  }

  async expectProviderOptionVisible(providerName: string): Promise<void> {
    await expect(this.providerPicker).toBeVisible();
    await expect(this.getProviderOption(providerName)).toBeVisible();
  }

  async selectProviderOption(providerName: string): Promise<void> {
    await this.getProviderOption(providerName).click();
    await expect(this.dialog.getByTestId('inline-connection-form')).toBeVisible();
  }

  async expectDashboardVisible(): Promise<void> {
    await expect(this.page.getByRole(SELECTORS.NAVIGATION.role, { name: SELECTORS.NAVIGATION.name })).toBeVisible();
  }

  async complete(): Promise<void> {
    await expect(this.continueButton).toBeEnabled();
    await this.continueButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await expect(this.welcomePage).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await waitForNavigationReady(this.page);
  }

  async skip(): Promise<void> {
    await expect(this.skipButton).toBeEnabled();
    await this.skipButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await expect(this.welcomePage).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await waitForNavigationReady(this.page);
  }

  private async createInlineConnection(setup: ResolvedAgentModelSetup): Promise<void> {
    const form = this.dialog.getByTestId('inline-connection-form');
    const button = this.providerPicker.getByRole('button', {
      name: new RegExp(`Select ${setup.providerName}`, 'i'),
    });
    if (await button.isVisible()) {
      await button.click();
    }
    await expect(form).toBeVisible();
    for (const field of setup.fields) {
      const input = form.getByLabel(field.label);
      await expect(input).toBeVisible();
      await this.fillSecret(input, field.value);
    }
    try {
      await form.getByRole('button', { name: 'Create' }).click();
    } finally {
      for (const field of setup.fields) {
        await form
          .getByLabel(field.label)
          .fill('')
          .catch(() => {});
      }
    }

    const closePanel = form.getByRole('button', { name: 'Close panel' });
    await expect(this.modelRows.first().or(closePanel)).toBeVisible({
      timeout: TIMEOUTS.STANDARD,
    });
  }

  private async selectGuidedSetupDefaultModel(agent: CodingAgent): Promise<void> {
    const radios = this.dialog.locator('input[name="modelSelection"]');
    // OpenCode: pick last so persistence differs from the app's first-model default when setup was skipped.
    const radio = agent === CODING_AGENT.OPENCODE ? radios.last() : radios.first();
    await this.selectRadio(radio);
  }

  private async selectRadio(radio: Locator): Promise<void> {
    await expect(radio).toBeVisible();
    if (!(await radio.isChecked())) {
      await radio.click();
    }
    await expect(radio).toBeChecked();
  }
}
