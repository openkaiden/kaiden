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
  type CodingAgent,
  FILE_ACCESS_LEVEL,
  type FileAccessLevel,
  NETWORK_ACCESS_LEVEL,
  type NetworkAccessLevel,
  TIMEOUTS,
  WIZARD_STEP,
  WIZARD_STEPS,
  type WizardStep,
  type WorkspaceCustomMount,
} from '/@/model/core/types';

import type { InlineConnectionField, ResolvedAgentModelSetup } from './agent-model-setup';
import { BasePage } from './base-page';

export type AgentModelSetup = (createPage: AgentWorkspaceCreatePage) => Promise<void>;

export {
  agentModelSetupSkipMessage,
  agentModelSetupSkipMessageFor,
  buildInlineConnectionFields,
  type InlineConnectionField,
  isAgentModelSetupAvailable,
  isLocalRuntimeAvailable,
  resolveAgentModelConnection,
  resolveAgentModelConnectionFor,
  type ResolvedAgentModelSetup,
} from './agent-model-setup';

export class AgentWorkspaceCreatePage extends BasePage {
  readonly heading: Locator;
  readonly sessionNameInput: Locator;
  readonly workingDirInput: Locator;
  readonly browseButton: Locator;
  readonly descriptionToggle: Locator;
  readonly descriptionInput: Locator;
  readonly agentSelector: Locator;
  readonly toolsSummary: Locator;
  readonly customizeExpandable: Locator;
  readonly mcpServersPanel: Locator;
  readonly fileAccessHeading: Locator;
  readonly firstCustomPathInput: Locator;
  readonly addPathButton: Locator;
  readonly wizardStepper: Locator;
  readonly cancelButton: Locator;
  readonly continueButton: Locator;
  readonly backButton: Locator;
  readonly submitButton: Locator;
  readonly useDefaultsButton: Locator;
  readonly noModelsGate: Locator;
  readonly providerPicker: Locator;
  readonly inlineConnectionForm: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = this.page.getByRole('heading', { name: 'Create Coding Agent Workspace' });
    this.sessionNameInput = this.page.getByPlaceholder('e.g., front-refactor');
    this.workingDirInput = this.page.getByPlaceholder('/path/to/project');
    this.browseButton = this.page.getByLabel('Browse for folder');
    this.descriptionToggle = this.page.getByRole('button', { name: /Description/ });
    this.descriptionInput = this.page.getByRole('textbox', { name: 'Description' });
    this.agentSelector = this.page.getByRole('listbox', { name: 'Coding agent' });
    this.toolsSummary = this.page.getByText(/Everything available is included|Expand.*Customize/);
    this.customizeExpandable = this.page.getByText('Customize skills, MCP servers, vault, and knowledges');
    this.mcpServersPanel = this.page.getByText('MCP Servers', { exact: true });
    this.fileAccessHeading = this.page.getByText('File System Access');
    this.firstCustomPathInput = this.page.getByPlaceholder('/path/on/host').first();
    this.addPathButton = this.page.getByRole('button', { name: 'Add Another Mount' });
    this.wizardStepper = this.page.getByLabel('Wizard progress');
    this.cancelButton = this.page.getByRole('button', { name: 'Cancel' });
    this.continueButton = this.page.getByRole('button', { name: 'Continue' });
    this.backButton = this.page.getByRole('button', { name: 'Back', exact: true });
    this.submitButton = this.page.getByRole('button', { name: 'Start Workspace' });
    this.useDefaultsButton = this.page.getByRole('button', {
      name: 'Use all defaults and create workspace',
      exact: true,
    });
    this.noModelsGate = this.page.getByTestId('no-models-create-connection');
    this.providerPicker = this.page.getByTestId('provider-picker');
    this.inlineConnectionForm = this.page.getByTestId('inline-connection-form');
  }

  async waitForLoad(): Promise<void> {
    await expect(this.heading).toBeVisible({ timeout: TIMEOUTS.SHORT });
    // The wizard draft store persists currentStepIndex across mounts, so
    // re-opening the wizard may land on a non-first step. Reset to Workspace.
    if (!(await this.workingDirInput.isVisible())) {
      await this.getStepButton(WIZARD_STEP.WORKSPACE).click();
    }
    await expect(this.workingDirInput).toBeVisible({ timeout: TIMEOUTS.SHORT });
  }

  getStepButton(step: WizardStep): Locator {
    return this.wizardStepper.getByLabel(`${step} step`);
  }

  async expectStepActive(step: WizardStep): Promise<void> {
    await expect(this.getStepButton(step)).toHaveAttribute('aria-current', 'step');
  }

  async continueToStep(step: WizardStep): Promise<void> {
    // Only the Workspace step's Continue button is gated on gateway availability, so restrict
    // this diagnostic to that transition to avoid misattributing unrelated disabled-button
    // causes on other steps. Wait for Continue first: a fresh app profile can show the
    // no-gateway banner while the local gateway is still starting.
    const leavesWorkspaceStep = WIZARD_STEPS[WIZARD_STEPS.indexOf(step) - 1] === WIZARD_STEP.WORKSPACE;
    if (leavesWorkspaceStep) {
      try {
        await expect(this.continueButton).toBeEnabled({ timeout: TIMEOUTS.STANDARD });
      } catch (error) {
        await this.assertGatewayAvailable();
        throw error;
      }
    } else {
      await expect(this.continueButton).toBeEnabled();
    }
    await this.continueButton.click();
    await this.expectStepActive(step);
  }

  async backToStep(step: WizardStep): Promise<void> {
    await expect(this.backButton).toBeVisible();
    await this.backButton.click();
    await this.expectStepActive(step);
  }

  async navigateToStep(step: WizardStep, agentModelSetup?: AgentModelSetup): Promise<void> {
    const targetIndex = WIZARD_STEPS.indexOf(step);
    for (let i = 0; i < targetIndex; i++) {
      const currentStep = WIZARD_STEPS[i]!;
      if (currentStep === WIZARD_STEP.AGENT_MODEL && agentModelSetup) {
        await agentModelSetup(this);
      }
      await this.continueToStep(WIZARD_STEPS[i + 1]!);
    }
  }

  async fillDescription(desc: string): Promise<void> {
    if (!(await this.descriptionInput.isVisible())) {
      await this.descriptionToggle.click();
      await expect(this.descriptionInput).toBeVisible();
    }
    await this.descriptionInput.fill(desc);
  }

  getAgentCard(agent: CodingAgent): Locator {
    return this.agentSelector
      .locator(`button[role="option"]`)
      .filter({ has: this.page.getByText(agent, { exact: true }) });
  }

  async selectAgent(agent: CodingAgent): Promise<void> {
    const card = this.getAgentCard(agent);
    if ((await card.getAttribute('aria-selected')) !== 'true') {
      await card.click();
    }
    await expect(card).toHaveAttribute('aria-selected', 'true');
  }

  async expectAgentSelected(agent: CodingAgent): Promise<void> {
    await expect(this.getAgentCard(agent)).toHaveAttribute('aria-selected', 'true');
  }

  async getSelectedModelLabel(): Promise<string> {
    const selected = this.page.getByTestId('selected-model');
    if (await selected.isVisible()) {
      const text = await selected.textContent();
      return text?.replace(/^Selected:\s*/, '').trim() ?? '';
    }
    const checked = this.page.locator('input[name="modelSelection"]:checked');
    await expect(checked).toBeVisible();
    const ariaLabel = await checked.getAttribute('aria-label');
    return ariaLabel?.replace(/^Use\s+/, '') ?? '';
  }

  async expectModelSelected(modelLabel: string): Promise<void> {
    const row = this.page.getByTestId(`model-row-${modelLabel}`);
    await expect(row.locator('input[name="modelSelection"]')).toBeChecked();
    await expect(this.page.getByTestId('selected-model')).toHaveText(`Selected: ${modelLabel}`);
  }

  async expandCustomize(): Promise<void> {
    await expect(this.customizeExpandable).toBeVisible();
    await this.customizeExpandable.click();
  }

  getCardByName(name: string): Locator {
    return this.page.getByText(name, { exact: true });
  }

  getFileAccessOption(level: FileAccessLevel): Locator {
    return this.page.getByRole('button', { name: level, exact: true });
  }

  async selectFileAccess(level: FileAccessLevel): Promise<void> {
    await this.getFileAccessOption(level).click();
    await expect(this.page.getByRole('radio', { name: `Use ${level}` })).toBeChecked();
  }

  getCustomMountHostInput(index = 0): Locator {
    return this.page.getByLabel(`Host path ${index + 1}`);
  }

  getCustomMountTargetInput(index = 0): Locator {
    return this.page.getByLabel(`Target path ${index + 1}`);
  }

  async fillCustomMount(mount: WorkspaceCustomMount, index = 0): Promise<void> {
    await this.getCustomMountHostInput(index).fill(mount.host);
    if (mount.target !== undefined) {
      await this.getCustomMountTargetInput(index).fill(mount.target);
    }
    if (mount.readOnly) {
      const toggle = this.page.getByRole('button', { name: `Toggle read-only for mount ${index + 1}` });
      const label = await toggle.textContent();
      if (label?.includes('read-write')) {
        await toggle.click();
      }
    }
  }

  async configureCustomMount(mount: WorkspaceCustomMount, index = 0): Promise<void> {
    await this.selectFileAccess(FILE_ACCESS_LEVEL.CUSTOM_PATHS);
    await this.fillCustomMount(mount, index);
  }

  getNetworkOption(level: NetworkAccessLevel): Locator {
    return this.page.getByRole('radio', { name: `Use ${level}` });
  }

  async selectNetwork(level: NetworkAccessLevel): Promise<void> {
    const option = this.getNetworkOption(level);
    await expect(option).toBeEnabled();
    await option.click();
    await expect(option).toBeChecked();
  }

  getCustomHostInput(index: number): Locator {
    return this.page.getByLabel(`Custom host ${index + 1}`);
  }

  async fillCustomHost(index: number, value: string): Promise<void> {
    await this.getCustomHostInput(index).fill(value);
  }

  async addCustomHost(): Promise<void> {
    await this.page.getByRole('button', { name: 'Add Another Host' }).click();
  }

  async configureNetworkingStep(
    network: NetworkAccessLevel,
    options?: { denyHosts?: string[]; additionalHosts?: string[] },
  ): Promise<void> {
    await this.selectNetwork(network);

    if (network === NETWORK_ACCESS_LEVEL.DENY_ALL && options?.denyHosts?.length) {
      for (let index = 0; index < options.denyHosts.length; index++) {
        if (index > 0) {
          await this.addCustomHost();
        }
        await this.fillCustomHost(index, options.denyHosts[index]!);
      }
    }

    if (network === NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET && options?.additionalHosts?.length) {
      let hostIndex = await this.page.getByLabel(/^Custom host \d+$/).count();
      for (const host of options.additionalHosts) {
        await this.addCustomHost();
        await this.fillCustomHost(hostIndex, host);
        hostIndex++;
      }
    }
  }

  async configureFileSystemStep(fileAccess: FileAccessLevel, customMounts?: WorkspaceCustomMount[]): Promise<void> {
    if (fileAccess === FILE_ACCESS_LEVEL.CUSTOM_PATHS) {
      const mounts = customMounts ?? [];
      if (mounts.length === 0) {
        throw new Error('Custom Paths requires at least one mount');
      }
      await this.configureCustomMount(mounts[0]!, 0);
      for (let index = 1; index < mounts.length; index++) {
        await this.addPathButton.click();
        await this.fillCustomMount(mounts[index]!, index);
      }
      return;
    }
    await this.selectFileAccess(fileAccess);
  }

  async completeSandboxWizardSteps(options: {
    fileAccess: FileAccessLevel;
    customMounts?: WorkspaceCustomMount[];
    network: NetworkAccessLevel;
    denyHosts?: string[];
    additionalHosts?: string[];
  }): Promise<void> {
    await this.continueToStep(WIZARD_STEP.TOOLS_SECRETS);
    await this.continueToStep(WIZARD_STEP.FILE_SYSTEM);
    await this.configureFileSystemStep(options.fileAccess, options.customMounts);
    await this.continueToStep(WIZARD_STEP.NETWORKING);
    await this.configureNetworkingStep(options.network, {
      denyHosts: options.denyHosts,
      additionalHosts: options.additionalHosts,
    });
  }

  async cancel(): Promise<void> {
    await expect(this.cancelButton).toBeEnabled();
    await this.cancelButton.click();
  }

  async closeIfOpen(): Promise<void> {
    if (await this.cancelButton.isVisible().catch(() => false)) {
      await this.cancel();
    }
  }

  async startWithDefaults(): Promise<void> {
    await expect(this.useDefaultsButton).toBeEnabled();
    await this.useDefaultsButton.click();
  }

  async startWorkspace(): Promise<void> {
    await expect(this.submitButton).toBeEnabled();
    await this.submitButton.click();
  }

  get modelList(): Locator {
    return this.page.getByRole('table', { name: /models/ });
  }

  async waitForModelCatalog(timeout: number = TIMEOUTS.DEFAULT): Promise<void> {
    await expect
      .poll(async () => await this.getModelTableRows().count(), {
        timeout,
        intervals: [500, 1_000, 2_000],
        message: 'Model catalog did not populate in workspace wizard',
      })
      .toBeGreaterThan(0);
    await expect(this.modelList.first()).toBeVisible({ timeout: TIMEOUTS.STANDARD });
  }

  get modelSearchInput(): Locator {
    return this.page.getByRole('searchbox', { name: 'Filter catalog models' });
  }

  async searchModel(term: string): Promise<void> {
    await expect(this.modelSearchInput).toBeVisible();
    await this.modelSearchInput.fill(term);
    await expect(this.getModelTableRows().first()).toBeVisible();
  }

  getModelTableRows(): Locator {
    return this.page.locator('[data-testid^="model-row-"]');
  }

  getModelRowRuntime(row: Locator): Locator {
    return row.locator('td').nth(3);
  }

  async selectDefaultModel(): Promise<string> {
    return this.selectRadio(this.page.locator('input[name="modelSelection"]').first());
  }

  async selectModelByRuntime(runtime: string): Promise<string> {
    const row = this.getModelTableRows()
      .filter({ has: this.page.getByRole('cell', { name: runtime, exact: true }) })
      .first();
    return this.selectRadio(row.locator('input[name="modelSelection"]'));
  }

  async verifyModelRuntimes(expectedRuntime: string): Promise<void> {
    const rows = this.getModelTableRows();
    const count = await rows.count();
    expect(count, 'Expected at least one model row').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const runtimeCell = this.getModelRowRuntime(rows.nth(i));
      await expect(runtimeCell).toHaveText(expectedRuntime);
    }
  }

  async searchAndSelectByRuntime(searchTerm: string, runtime: string): Promise<string> {
    await this.searchModel(searchTerm);
    return this.selectModelByRuntime(runtime);
  }

  async searchAndSelectDefault(searchTerm: string, verifyRuntime?: string): Promise<string> {
    await this.searchModel(searchTerm);
    if (verifyRuntime) {
      await this.verifyModelRuntimes(verifyRuntime);
    }
    return this.selectDefaultModel();
  }

  async isModelCatalogVisible(): Promise<boolean> {
    return (await this.getModelTableRows().count()) > 0;
  }

  async selectConnectionProvider(providerName: string): Promise<void> {
    if (await this.providerPicker.isVisible()) {
      const button = this.providerPicker.getByRole('button', {
        name: new RegExp(`Select ${providerName}`, 'i'),
      });
      await expect(button).toBeVisible();
      await button.click();
    }
    await expect(this.inlineConnectionForm).toBeVisible();
  }

  async fillInlineConnectionFields(fields: InlineConnectionField[]): Promise<void> {
    for (const field of fields) {
      const input = this.inlineConnectionForm.getByLabel(field.label);
      await expect(input).toBeVisible();
      await this.fillSecret(input, field.value);
    }
  }

  async submitInlineConnection(): Promise<void> {
    const createButton = this.inlineConnectionForm.getByRole('button', { name: 'Create' });
    await expect(createButton).toBeEnabled();
    await createButton.click();
  }

  async ensureModelReady(setup: ResolvedAgentModelSetup): Promise<void> {
    if (await this.isModelCatalogVisible()) {
      await this.selectDefaultModel();
    } else if (await this.noModelsGate.isVisible()) {
      await this.selectConnectionProvider(setup.providerName);
      await this.fillInlineConnectionFields(setup.fields);
      try {
        await this.submitInlineConnection();
      } finally {
        for (const field of setup.fields) {
          await this.inlineConnectionForm
            .getByLabel(field.label)
            .fill('')
            .catch(() => {});
        }
      }
      await this.waitForModelCatalog();
      await this.selectDefaultModel();
    } else {
      await this.waitForModelCatalog();
      await this.selectDefaultModel();
    }
    await expect(this.continueButton).toBeEnabled();
  }

  async completeAvailableAgentModelStep(setup: ResolvedAgentModelSetup): Promise<void> {
    await this.selectAgent(setup.agent);
    await this.ensureModelReady(setup);
  }

  async completeAgentModelStepIfNeeded(setup: AgentModelSetup): Promise<void> {
    if (await this.continueButton.isDisabled()) {
      await setup(this);
    }
  }

  private async selectRadio(radio: Locator): Promise<string> {
    await expect(radio).toBeVisible();
    if (!(await radio.isChecked())) {
      await radio.click();
    }
    await expect(radio).toBeChecked();
    const ariaLabel = await radio.getAttribute('aria-label');
    return ariaLabel?.replace(/^Use\s+/, '') ?? '';
  }
}
