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

test.describe('Workspaces page', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test.describe('given no workspaces exist', () => {
    test('[WS-01] should display the heading, create button and search input', async ({ agentWorkspacesPage }) => {
      await expect(agentWorkspacesPage.heading).toBeVisible();
      await expect(agentWorkspacesPage.createButton).toBeVisible();
      await expect(agentWorkspacesPage.createButton).toBeEnabled();
      await expect(agentWorkspacesPage.searchInput).toBeVisible();
    });

    test('[WS-02] should show the empty state message', async ({ agentWorkspacesPage }) => {
      await expect(agentWorkspacesPage.noWorkspacesMessage).toBeVisible();
      await expect(agentWorkspacesPage.table).not.toBeVisible();
    });
  });

  test.describe('when searching for a non-existent workspace', () => {
    test('[WS-03] should show filtered empty state and clear filter restores the view', async ({
      agentWorkspacesPage,
    }) => {
      await agentWorkspacesPage.search('non-existent-workspace-xyz');
      await expect(agentWorkspacesPage.filteredEmptyMessage).toBeVisible();
      await expect(agentWorkspacesPage.clearFilterButton).toBeVisible();

      await agentWorkspacesPage.clearFilterButton.click();
      await expect(agentWorkspacesPage.filteredEmptyMessage).not.toBeVisible();
      await expect(agentWorkspacesPage.searchInput).toHaveValue('');
    });
  });
});

test.describe('Create workspace wizard', { tag: '@smoke' }, () => {
  const testWorkspace = {
    name: 'Test Workspace',
    workingDir: '/tmp/test-project',
    description: 'A test workspace',
  };

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test.describe('given the wizard is opened', () => {
    test('[WS-04] should show step 1 with form fields and disabled Continue button', async ({
      agentWorkspacesPage,
    }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await expect(createPage.heading).toBeVisible();
      await expect(createPage.sessionNameInput).toBeVisible();
      await expect(createPage.workingDirInput).toBeVisible();
      await expect(createPage.browseButton).toBeVisible();
      await expect(createPage.continueButton).toBeDisabled();
      await expect(createPage.cancelButton).toBeEnabled();
      await expect(createPage.backButton).not.toBeVisible();
    });

    test('[WS-05] should display all wizard steps with Workspace active', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await expect(createPage.wizardStepper).toBeVisible();
      for (const step of WIZARD_STEPS) {
        await expect(createPage.getStepButton(step)).toBeVisible();
      }
      await createPage.expectStepActive(WIZARD_STEP.WORKSPACE);
    });
  });

  test.describe('when filling step 1 (Workspace)', () => {
    test('[WS-06] should enable Continue and Use-defaults buttons after filling project folder', async ({
      agentWorkspacesPage,
    }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await expect(createPage.continueButton).toBeDisabled();

      await createPage.workingDirInput.fill(testWorkspace.workingDir);

      await expect(createPage.continueButton).toBeEnabled();
      await expect(createPage.useDefaultsButton).toBeEnabled();
    });

    test('[WS-07] should accept session name, working directory and description', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.sessionNameInput.fill(testWorkspace.name);
      await createPage.workingDirInput.fill(testWorkspace.workingDir);
      await createPage.fillDescription(testWorkspace.description);

      await expect(createPage.sessionNameInput).toHaveValue(testWorkspace.name);
      await expect(createPage.workingDirInput).toHaveValue(testWorkspace.workingDir);
      await expect(createPage.descriptionInput).toHaveValue(testWorkspace.description);
    });
  });

  test.describe('when navigating to step 2 (Agent & Model)', () => {
    test('[WS-08] should display all coding agents and allow selection', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill('/tmp/test');
      await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);

      await expect(createPage.agentSelector).toBeVisible();
      for (const agent of CODING_AGENTS) {
        await expect(createPage.getAgentCard(agent)).toBeVisible();
        await createPage.selectAgent(agent);
      }
    });
  });

  test.describe('when navigating to step 3 (Tools & Secrets)', () => {
    test('[WS-09] should hide skills and MCP sections when none are configured', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill('/tmp/test');
      await createPage.navigateToStep(WIZARD_STEP.TOOLS_SECRETS);

      await expect(createPage.skillsSearchInput).not.toBeVisible();
      await expect(createPage.mcpServersSearchInput).not.toBeVisible();
    });
  });

  test.describe('when navigating to step 4 (File System)', () => {
    test('[WS-10] should allow selecting file access levels and show custom paths only for Custom Paths', async ({
      agentWorkspacesPage,
    }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill(testWorkspace.workingDir);
      await createPage.navigateToStep(WIZARD_STEP.FILE_SYSTEM);

      await expect(createPage.fileAccessSelector).toBeVisible();
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
  });

  test.describe('when navigating to the last step (Networking)', () => {
    test('[WS-11] should show Start Workspace button and hide Continue', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill(testWorkspace.workingDir);
      await createPage.navigateToStep(WIZARD_STEP.NETWORKING);

      await expect(createPage.submitButton).toBeVisible();
      await expect(createPage.submitButton).toBeEnabled();
      await expect(createPage.continueButton).not.toBeVisible();
      await expect(createPage.backButton).toBeVisible();
    });
  });

  test.describe('wizard navigation', () => {
    test('[WS-12] should return to the previous step when clicking Back', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill('/tmp/test');
      await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);
      await createPage.expectStepActive(WIZARD_STEP.AGENT_MODEL);

      await createPage.goToPreviousStep();
      await createPage.expectStepActive(WIZARD_STEP.WORKSPACE);
      await expect(createPage.sessionNameInput).toBeVisible();
    });

    test('[WS-13] should navigate back to workspaces list when clicking Cancel', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();
      await createPage.cancel();
      await expect(agentWorkspacesPage.heading).toBeVisible();
    });
  });

  test.describe('scenario: use all defaults and create workspace', () => {
    test('[WS-14] should create workspace from step 1 and return to workspaces list', async ({
      agentWorkspacesPage,
    }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill(testWorkspace.workingDir);
      await createPage.startWithDefaults();

      await expect(agentWorkspacesPage.heading).toBeVisible();
    });
  });

  test.describe('scenario: complete step-by-step creation', () => {
    test('[WS-15] should fill all steps and create workspace', async ({ agentWorkspacesPage }) => {
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.sessionNameInput.fill(testWorkspace.name);
      await createPage.workingDirInput.fill(testWorkspace.workingDir);
      await createPage.fillDescription(testWorkspace.description);
      await createPage.goToNextStep();

      await createPage.selectAgent(CODING_AGENT.CLAUDE);
      await createPage.goToNextStep();

      await createPage.goToNextStep();

      await createPage.selectFileAccess(FILE_ACCESS_LEVEL.WORKING_DIR_ONLY);
      await createPage.goToNextStep();

      await createPage.startWorkspace();

      await expect(agentWorkspacesPage.heading).toBeVisible();
    });
  });
});

test.describe
  .serial('Create workspace - skills integration', { tag: '@smoke' }, () => {
    const testSkill = {
      name: 'e2e-workspace-test-skill',
      description: 'Skill for workspace e2e test',
      content: '# Test Skill\n\nThis is a test skill for e2e testing.',
    };

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[WS-16] should show skills section on step 3 after creating a skill', async ({
      navigationBar,
      skillsPage,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.createSkill(testSkill.name, testSkill.description, testSkill.content);
      await skillsPage.ensureRowExists(testSkill.name);

      await navigationBar.navigateToWorkspacesPage();
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill('/tmp/test');
      await createPage.navigateToStep(WIZARD_STEP.TOOLS_SECRETS);

      await expect(createPage.skillsSearchInput).toBeVisible();
      await expect(createPage.getCardByName(testSkill.name)).toBeVisible();
    });

    test('cleanup: delete the test skill', async ({ navigationBar, skillsPage }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.deleteSkillByName(testSkill.name);
      await skillsPage.ensureRowDoesNotExist(testSkill.name);
    });
  });

test.describe
  .serial('Create workspace - MCP integration', { tag: '@smoke' }, () => {
    const githubServer = MCP_SERVERS.github;
    const hasGithubToken = !!process.env[githubServer.envVarName];

    test.skip(!hasGithubToken, `${githubServer.envVarName} environment variable is not set`);

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[WS-17] should show MCP servers section on step 3 after adding a server', async ({
      navigationBar,
      mcpPage,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToMCPPage();
      await mcpPage.createServer(githubServer.serverName, process.env[githubServer.envVarName]!);

      await navigationBar.navigateToWorkspacesPage();
      const createPage = await agentWorkspacesPage.openCreatePage();

      await createPage.workingDirInput.fill('/tmp/test');
      await createPage.navigateToStep(WIZARD_STEP.TOOLS_SECRETS);

      await expect(createPage.mcpServersSearchInput).toBeVisible();
      await expect(createPage.getCardByName(githubServer.serverName)).toBeVisible();
    });

    test('cleanup: delete the MCP server', async ({ navigationBar, mcpPage }) => {
      await navigationBar.navigateToMCPPage();
      await mcpPage.deleteServer(githubServer.serverName);
    });
  });
