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

import { expect, workerTest as test } from '/@/fixtures/electron-app';
import { CODING_AGENT, TIMEOUTS, WIZARD_STEP, WORKSPACE_STATUS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESOURCES = resolve(__dirname, '../../resources');

const ATTACHMENT_CASES = [
  { file: 'test-doc.md', label: 'Markdown' },
  { file: 'test-doc.html', label: 'HTML' },
  { file: 'test-config.json', label: 'JSON' },
  { file: 'test-manifest.yaml', label: 'YAML Kubernetes manifest' },
  { file: 'test-script.py', label: 'Python script' },
] as const;

const WORKSPACE_NAME = 'acp-smoke-pr';
const MODEL_RESPONSE_TIMEOUT = 120_000;

const RUNTIME = process.env.OLLAMA_ENABLED
  ? { search: 'ollama', name: 'Ollama' }
  : process.env.RAMALAMA_ENABLED
    ? { search: 'ramalama', name: 'RamaLama' }
    : undefined;

test.skip(
  !!process.env.GITHUB_ACTIONS && process.platform !== 'linux',
  'ACP session e2e requires Podman + a local model runtime, only available on Linux GitHub Actions runners',
);
test.skip(!RUNTIME, 'Neither OLLAMA_ENABLED nor RAMALAMA_ENABLED is set — a local model runtime is required');

test.describe
  .serial('ACP sessions - lifecycle smoke', { tag: '@smoke' }, () => {
    let sessionLabel: string;

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test(`[ACP-SES-01] Provision a workspace with OpenCode+${RUNTIME?.name}`, async ({
      navigationBar,
      agentWorkspacesPage,
    }) => {
      await navigationBar.ensureExtensionsRunning();
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(WORKSPACE_NAME);

      const createPage = await agentWorkspacesPage.openCreatePage();
      await createPage.sessionNameInput.fill(WORKSPACE_NAME);
      await createPage.workingDirInput.fill('/tmp/acp-smoke-pr');
      await createPage.continueToStep(WIZARD_STEP.AGENT_MODEL);
      await createPage.selectAgent(CODING_AGENT.OPENCODE);
      await createPage.waitForModelCatalog();
      await createPage.searchAndSelectByRuntime(RUNTIME!.search, RUNTIME!.name);
      await createPage.continueToStep(WIZARD_STEP.TOOLS_SECRETS);
      await createPage.continueToStep(WIZARD_STEP.FILE_SYSTEM);
      await createPage.continueToStep(WIZARD_STEP.NETWORKING);
      await createPage.startWorkspace();

      await agentWorkspacesPage.expectWorkspaceCreated(WORKSPACE_NAME);
      await agentWorkspacesPage.waitForWorkspaceStatus(
        WORKSPACE_NAME,
        WORKSPACE_STATUS.RUNNING,
        TIMEOUTS.WORKSPACE_READY,
      );
    });

    test('[ACP-SES-02] Create a session and receive a model response', async ({
      navigationBar,
      agentSessionsPage,
      agentSessionDetailPage,
    }) => {
      await navigationBar.navigateToAgentsPage();
      await expect(agentSessionsPage.createButton).toBeEnabled({ timeout: TIMEOUTS.WORKSPACE_READY });

      const prompt = 'Reply with exactly the single word "pong". Do not use any tools or read any files.';
      const createDialog = await agentSessionsPage.openCreateDialog();
      await createDialog.fillPrompt(prompt);
      await agentSessionDetailPage.installTurnObserver();
      await createDialog.submit();
      await agentSessionDetailPage.markTurnSent();

      await agentSessionDetailPage.waitForLoad();
      await expect(agentSessionDetailPage.getPromptEvent(prompt)).toBeVisible();

      sessionLabel = prompt.slice(0, 40);
      await agentSessionDetailPage.waitForTurnCompletion(MODEL_RESPONSE_TIMEOUT);
      await expect(agentSessionDetailPage.agentMessage.first()).toBeVisible();
    });

    for (const [i, { file, label }] of ATTACHMENT_CASES.entries()) {
      test(`[ACP-SES-03.${i + 1}] Attach ${label} file and receive a response`, async ({
        navigationBar,
        agentSessionsPage,
        agentSessionDetailPage,
        electronApp,
      }) => {
        await navigationBar.navigateToAgentsPage();
        await agentSessionsPage.sidebar.openSession(sessionLabel);
        await agentSessionDetailPage.waitForLoad();

        const filePath = resolve(RESOURCES, file);
        await agentSessionDetailPage.attachFile(filePath, electronApp);
        await expect(agentSessionDetailPage.getAttachmentChip(file)).toBeVisible();

        await agentSessionDetailPage.installTurnObserver();
        await agentSessionDetailPage.sendFollowUp('What is this file about? Reply in one sentence.');
        await agentSessionDetailPage.markTurnSent();

        await agentSessionDetailPage.waitForTurnCompletion(MODEL_RESPONSE_TIMEOUT);
      });
    }

    test('[ACP-SES-04] Rename a session via the sidebar', async ({ navigationBar, agentSessionsPage }) => {
      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.renameSession(sessionLabel, 'smoke-renamed');
      await expect(agentSessionsPage.sidebar.getSessionRow('smoke-renamed')).toBeVisible();
      sessionLabel = 'smoke-renamed';
    });

    test('[ACP-SES-05] Search filters sessions and clearing restores the list', async ({
      navigationBar,
      agentSessionsPage,
    }) => {
      await navigationBar.navigateToAgentsPage();

      await agentSessionsPage.search(sessionLabel);
      await expect(agentSessionsPage.getSessionRowByText(sessionLabel)).toBeVisible();

      await agentSessionsPage.search('no-match-xyz');
      await expect(agentSessionsPage.filteredEmptyMessage).toBeVisible();
      await agentSessionsPage.clearFilterButton.click();
      await expect(agentSessionsPage.searchInput).toHaveValue('');
    });

    test('[ACP-SES-06] Removing the workspace marks the session read-only', async ({
      navigationBar,
      agentWorkspacesPage,
      agentSessionsPage,
      agentSessionDetailPage,
    }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(WORKSPACE_NAME);

      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.openSession(sessionLabel);
      await agentSessionDetailPage.waitForLoad();

      await expect(agentSessionDetailPage.staleSandboxBanner).toBeVisible({ timeout: TIMEOUTS.STANDARD });
      await expect(agentSessionDetailPage.followUpTextarea).not.toBeVisible();
    });

    test('[ACP-SES-07] Delete the session', async ({ navigationBar, agentSessionsPage }) => {
      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.deleteSession(sessionLabel);
      await expect(agentSessionsPage.sidebar.getSessionRow(sessionLabel)).toHaveCount(0, {
        timeout: TIMEOUTS.STANDARD,
      });
    });
  });
