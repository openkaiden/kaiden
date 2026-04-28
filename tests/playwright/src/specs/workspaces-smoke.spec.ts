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

import { CODING_AGENTS, FILE_ACCESS_LEVEL, FILE_ACCESS_LEVELS, MCP_SERVERS } from 'src/model/core/types';

import { expect, workerTest as test } from '../fixtures/electron-app';
import { waitForNavigationReady } from '../utils/app-ready';

test.describe('Workspaces page - initial state', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test('[WKS-INIT-01] Workspaces page renders with heading and create button', async ({ agentWorkspacesPage }) => {
    await expect(agentWorkspacesPage.heading).toBeVisible();
    await expect(agentWorkspacesPage.createButton).toBeVisible();
    await expect(agentWorkspacesPage.createButton).toBeEnabled();
    await expect(agentWorkspacesPage.searchInput).toBeVisible();
  });

  test('[WKS-INIT-02] Empty state is shown when no workspaces exist', async ({ agentWorkspacesPage }) => {
    await expect(agentWorkspacesPage.noWorkspacesMessage).toBeVisible();
    await expect(agentWorkspacesPage.table).not.toBeVisible();
  });
});

test.describe('Workspaces page - create form', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test('[WKS-CREATE-01] Create page loads with correct initial state', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await expect(createPage.heading).toBeVisible();
    await expect(createPage.sessionNameInput).toBeVisible();
    await expect(createPage.workingDirInput).toBeVisible();
    await expect(createPage.browseButton).toBeVisible();
    await expect(createPage.descriptionInput).toBeVisible();
    await expect(createPage.submitButton).toBeDisabled();
  });

  test('[WKS-CREATE-02] Agent selector displays all coding agents', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await expect(createPage.agentSelector).toBeVisible();
    for (const agent of CODING_AGENTS) {
      await expect(createPage.agentSelector.getByLabel(agent)).toBeVisible();
    }
  });

  test('[WKS-CREATE-03] File system access selector displays all options', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await expect(createPage.fileAccessSelector).toBeVisible();
    for (const option of FILE_ACCESS_LEVELS) {
      await expect(createPage.fileAccessSelector.getByLabel(option)).toBeVisible();
    }
  });

  test('[WKS-CREATE-04] Cancel button navigates back to workspaces list', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();
    await createPage.cancel();
    await expect(agentWorkspacesPage.heading).toBeVisible();
  });

  test('[WKS-CREATE-05] Skills section is hidden when no skills exist', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();
    await expect(createPage.skillsSection).not.toBeVisible();
  });

  test('[WKS-CREATE-06] MCP Servers section is hidden when no MCP servers exist', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();
    await expect(createPage.mcpServersSection).not.toBeVisible();
  });
});

test.describe('Workspaces page - create form interactions', { tag: '@smoke' }, () => {
  const testWorkspace = {
    name: 'Test Workspace',
    workingDir: '/tmp/test-project',
    description: 'A test workspace',
  };

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test('[WKS-CREATE-07] Form fields and agent selection work correctly', async ({ agentWorkspacesPage }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.fillSessionName(testWorkspace.name);
    await createPage.fillWorkingDir(testWorkspace.workingDir);
    await createPage.fillDescription(testWorkspace.description);

    await expect(createPage.sessionNameInput).toHaveValue(testWorkspace.name);
    await expect(createPage.workingDirInput).toHaveValue(testWorkspace.workingDir);
    await expect(createPage.descriptionInput).toHaveValue(testWorkspace.description);

    for (const agent of CODING_AGENTS) {
      await createPage.selectAgent(agent);
      await createPage.expectAgentSelected(agent);
    }
  });

  test('[WKS-CREATE-08] File access options can be selected and custom paths only shows for Custom Paths', async ({
    agentWorkspacesPage,
  }) => {
    const createPage = await agentWorkspacesPage.openCreatePage();

    for (const level of FILE_ACCESS_LEVELS) {
      await createPage.selectFileAccess(level);

      if (level === FILE_ACCESS_LEVEL.CUSTOM_PATHS) {
        await expect(createPage.customPathsContainer).toBeVisible();
        await expect(createPage.addPathButton).toBeVisible();
      } else {
        await expect(createPage.addPathButton).not.toBeVisible();
      }
    }
  });
});

test.describe
  .serial('Workspaces page - skills integration', { tag: '@smoke' }, () => {
    const testSkill = {
      name: 'e2e-workspace-test-skill',
      description: 'Skill for workspace e2e test',
      content: '# Test Skill\n\nThis is a test skill for e2e testing.',
    };

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[WKS-SKILL-01] Skills section appears after creating a skill', async ({
      navigationBar,
      skillsPage,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.createSkill(testSkill.name, testSkill.description, testSkill.content);
      await skillsPage.ensureRowExists(testSkill.name);

      await navigationBar.navigateToWorkspacesPage();
      const createPage = await agentWorkspacesPage.openCreatePage();

      await expect(createPage.skillsSection).toBeVisible();
      await expect(createPage.skillsSearchInput).toBeVisible();
      await expect(createPage.skillsSection.getByText(testSkill.name)).toBeVisible();
    });

    test('[WKS-SKILL-02] Cleanup - delete the test skill', async ({ navigationBar, skillsPage }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.deleteSkillByName(testSkill.name);
      await skillsPage.ensureRowDoesNotExist(testSkill.name);
    });
  });

test.describe
  .serial('Workspaces page - MCP integration', { tag: '@smoke' }, () => {
    const githubServer = MCP_SERVERS.github;
    const hasGithubToken = !!process.env[githubServer.envVarName];

    test.skip(!hasGithubToken, `${githubServer.envVarName} environment variable is not set`);

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[WKS-MCP-01] MCP Servers section appears after adding an MCP server', async ({
      navigationBar,
      mcpPage,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToMCPPage();
      await mcpPage.createServer(githubServer.serverName, process.env[githubServer.envVarName]!);

      await navigationBar.navigateToWorkspacesPage();
      const createPage = await agentWorkspacesPage.openCreatePage();

      await expect(createPage.mcpServersSection).toBeVisible();
      await expect(createPage.mcpServersSearchInput).toBeVisible();
      await expect(createPage.mcpServersSection.getByText(githubServer.serverName)).toBeVisible();
    });

    test('[WKS-MCP-02] Cleanup - delete the MCP server', async ({ navigationBar, mcpPage }) => {
      await navigationBar.navigateToMCPPage();
      await mcpPage.deleteServer(githubServer.serverName);
    });
  });

test.describe('Workspaces page - search', { tag: '@smoke' }, () => {
  const nonExistentWorkspace = 'non-existent-workspace-xyz';

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToWorkspacesPage();
  });

  test('[WKS-SEARCH-01] Search shows filtered empty state and clear filter restores the view', async ({
    agentWorkspacesPage,
  }) => {
    await agentWorkspacesPage.search(nonExistentWorkspace);
    await expect(agentWorkspacesPage.filteredEmptyMessage).toBeVisible();
    await expect(agentWorkspacesPage.clearFilterButton).toBeVisible();

    await agentWorkspacesPage.clearFilterButton.click();
    await expect(agentWorkspacesPage.filteredEmptyMessage).not.toBeVisible();
    await expect(agentWorkspacesPage.searchInput).toHaveValue('');
  });
});
