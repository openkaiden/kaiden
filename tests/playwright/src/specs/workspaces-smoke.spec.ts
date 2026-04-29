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

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CODING_AGENT,
  CODING_AGENTS,
  FILE_ACCESS_LEVEL,
  FILE_ACCESS_LEVELS,
  MCP_SERVERS,
  WIZARD_STEP,
  WIZARD_STEPS,
} from 'src/model/core/types';

import { expect, workerTest as test } from '../fixtures/electron-app';
import { waitForNavigationReady } from '../utils/app-ready';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SKILL = {
  file: resolve(__dirname, '../../../../.agents/skills/playwright-testing/SKILL.md'),
  name: 'playwright-testing',
};

test.describe('Workspaces page - initial state', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test('[WKS-INIT-01] Renders with heading, create button, search and empty state', async ({ agentWorkspacesPage }) => {
    await expect(agentWorkspacesPage.heading).toBeVisible();
    await expect(agentWorkspacesPage.createButton).toBeVisible();
    await expect(agentWorkspacesPage.createButton).toBeEnabled();
    await expect(agentWorkspacesPage.searchInput).toBeVisible();
    await expect(agentWorkspacesPage.noWorkspacesMessage).toBeVisible();
    await expect(agentWorkspacesPage.table).not.toBeVisible();
  });

  test('[WKS-INIT-02] Search shows no-results state and clears filter', async ({ agentWorkspacesPage }) => {
    await agentWorkspacesPage.search('non-existent-workspace-xyz');
    await expect(agentWorkspacesPage.filteredEmptyMessage).toBeVisible();
    await expect(agentWorkspacesPage.clearFilterButton).toBeVisible();

    await agentWorkspacesPage.clearFilterButton.click();
    await expect(agentWorkspacesPage.filteredEmptyMessage).not.toBeVisible();
    await expect(agentWorkspacesPage.searchInput).toHaveValue('');
  });
});

test.describe('Workspaces page - create wizard', { tag: '@smoke' }, () => {
  const testWorkspace = {
    name: 'Test Workspace',
    workingDir: '/tmp/test-project',
    description: 'A test workspace',
  };

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test('[WKS-WIZ-01] Opens with form, stepper and Continue disabled', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await expect(createPage.heading).toBeVisible();
    await expect(createPage.sessionNameInput).toBeVisible();
    await expect(createPage.workingDirInput).toBeVisible();
    await expect(createPage.browseButton).toBeVisible();
    await expect(createPage.continueButton).toBeDisabled();
    await expect(createPage.cancelButton).toBeEnabled();
    await expect(createPage.backButton).not.toBeVisible();

    await expect(createPage.wizardStepper).toBeVisible();
    for (const step of WIZARD_STEPS) {
      await expect(createPage.getStepButton(step)).toBeVisible();
    }
    await createPage.expectStepActive(WIZARD_STEP.WORKSPACE);
  });

  test('[WKS-WIZ-02] Form fields retain filled values', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.sessionNameInput.fill(testWorkspace.name);
    await createPage.workingDirInput.fill(testWorkspace.workingDir);
    await createPage.fillDescription(testWorkspace.description);

    await expect(createPage.sessionNameInput).toHaveValue(testWorkspace.name);
    await expect(createPage.workingDirInput).toHaveValue(testWorkspace.workingDir);
    await expect(createPage.descriptionInput).toHaveValue(testWorkspace.description);
  });

  test('[WKS-WIZ-03] Displays all coding agents and allows selection', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill('/tmp/test');
    await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);

    await expect(createPage.agentSelector).toBeVisible();
    for (const agent of CODING_AGENTS) {
      await expect(createPage.getAgentCard(agent)).toBeVisible();
      await createPage.selectAgent(agent);
    }
  });

  test('[WKS-WIZ-04] Shows summary and collapsed Customize section', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill('/tmp/test');
    await createPage.navigateToStep(WIZARD_STEP.TOOLS_SECRETS);

    await expect(createPage.toolsSummary).toBeVisible();
    await expect(createPage.customizeExpandable).toBeVisible();
  });

  test('[WKS-WIZ-05] Shows custom path inputs only for Custom Paths access level', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill(testWorkspace.workingDir);
    await createPage.navigateToStep(WIZARD_STEP.FILE_SYSTEM);

    await expect(createPage.fileAccessHeading).toBeVisible();
    for (const level of FILE_ACCESS_LEVELS) {
      await createPage.selectFileAccess(level);

      if (level === FILE_ACCESS_LEVEL.CUSTOM_PATHS) {
        await expect(createPage.firstCustomPathInput).toBeVisible();
        await expect(createPage.addPathButton).toBeVisible();
      } else {
        await expect(createPage.addPathButton).not.toBeVisible();
      }
    }
  });

  test('[WKS-WIZ-06] Replaces Continue with Start Workspace button on last step', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill(testWorkspace.workingDir);
    await createPage.navigateToStep(WIZARD_STEP.NETWORKING);

    await expect(createPage.submitButton).toBeVisible();
    await expect(createPage.submitButton).toBeEnabled();
    await expect(createPage.continueButton).not.toBeVisible();
    await expect(createPage.backButton).toBeVisible();
  });

  test('[WKS-WIZ-07] Back returns to previous step', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill('/tmp/test');
    await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);
    await createPage.expectStepActive(WIZARD_STEP.AGENT_MODEL);

    await createPage.backToStep(WIZARD_STEP.WORKSPACE);
    await expect(createPage.sessionNameInput).toBeVisible();
  });

  test('[WKS-WIZ-08] Cancel exits the wizard', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();
    await createPage.cancel();
    await expect(agentWorkspacesPage.heading).toBeVisible();
  });

  test('[WKS-WIZ-09] Use-defaults enables after folder and creates workspace', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await expect(createPage.continueButton).toBeDisabled();
    await expect(createPage.useDefaultsButton).toBeDisabled();

    await createPage.workingDirInput.fill(testWorkspace.workingDir);

    await expect(createPage.continueButton).toBeEnabled();
    await expect(createPage.useDefaultsButton).toBeEnabled();

    await createPage.startWithDefaults();

    await expect(agentWorkspacesPage.heading).toBeVisible();
  });

  test('[WKS-WIZ-10] Completes all steps and creates workspace', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.sessionNameInput.fill(testWorkspace.name);
    await createPage.workingDirInput.fill(testWorkspace.workingDir);
    await createPage.fillDescription(testWorkspace.description);
    await createPage.continueToStep(WIZARD_STEP.AGENT_MODEL);

    await createPage.selectAgent(CODING_AGENT.CLAUDE);
    await createPage.continueToStep(WIZARD_STEP.TOOLS_SECRETS);

    await createPage.continueToStep(WIZARD_STEP.FILE_SYSTEM);

    await createPage.selectFileAccess(FILE_ACCESS_LEVEL.NO_HOST_ACCESS);
    await createPage.continueToStep(WIZARD_STEP.NETWORKING);

    await createPage.startWorkspace();

    await expect(agentWorkspacesPage.heading).toBeVisible();
  });
});

test.describe('Workspaces page - skills integration', { tag: '@smoke' }, () => {
  test.beforeAll(async ({ page, electronApp, navigationBar, skillsPage }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToSkillsPage();
    await skillsPage.importSkill(TEST_SKILL.file, electronApp);
    await skillsPage.ensureRowExists(TEST_SKILL.name);
  });

  test.afterAll(async ({ navigationBar, skillsPage }) => {
    await navigationBar.navigateToSkillsPage();
    await skillsPage.deleteSkillByName(TEST_SKILL.name);
    await skillsPage.ensureRowDoesNotExist(TEST_SKILL.name);
  });

  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  test('[WKS-SKILL-01] Imported skill appears in the Customize section', async ({
    navigationBar,
    agentWorkspacesPage,
  }) => {
    await navigationBar.navigateToWorkspacesPage();
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill('/tmp/test');
    await createPage.navigateToStep(WIZARD_STEP.TOOLS_SECRETS);
    await createPage.expandCustomize();

    await expect(createPage.getCardByName(TEST_SKILL.name)).toBeVisible();
  });
});

test.describe('Workspaces page - MCP integration', { tag: '@smoke' }, () => {
  const githubServer = MCP_SERVERS.github;
  const hasGithubToken = !!process.env[githubServer.envVarName];

  test.skip(!hasGithubToken, `${githubServer.envVarName} environment variable is not set`);

  test.beforeAll(async ({ page, navigationBar, mcpPage }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToMCPPage();
    await mcpPage.createServer(githubServer.serverName, process.env[githubServer.envVarName]!);
  });

  test.afterAll(async ({ navigationBar, mcpPage }) => {
    await navigationBar.navigateToMCPPage();
    await mcpPage.deleteServer(githubServer.serverName);
  });

  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  test('[WKS-MCP-01] Configured server appears in the Customize section', async ({
    navigationBar,
    agentWorkspacesPage,
  }) => {
    await navigationBar.navigateToWorkspacesPage();
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.workingDirInput.fill('/tmp/test');
    await createPage.navigateToStep(WIZARD_STEP.TOOLS_SECRETS);
    await createPage.expandCustomize();

    await expect(createPage.mcpServersSearchInput).toBeVisible();
    await expect(createPage.getCardByName(githubServer.serverName)).toBeVisible();
  });
});
