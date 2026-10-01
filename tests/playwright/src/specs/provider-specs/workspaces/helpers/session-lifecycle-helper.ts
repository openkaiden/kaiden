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
 *
 * Shared lifecycle for ACP agent session E2E tests. See
 * .agents/skills/playwright-testing/scenario-lifecycle-e2e.md
 ***********************************************************************/

import type { test as providerTest } from '/@/fixtures/provider-fixtures';
import { expect } from '/@/fixtures/provider-fixtures';
import { type CodingAgent, type ResourceId, TIMEOUTS, WIZARD_STEP, WORKSPACE_STATUS } from '/@/model/core/types';
import type { AgentWorkspaceCreatePage } from '/@/model/pages/agent-workspace-create-page';

import {
  createRequiredResource,
  deleteRequiredResource,
  type EngineWorkerFixtures,
  registerScenarioLifecycleTests,
  type ScenarioStep,
  skipUnlessPlatformSupported,
} from './scenario-lifecycle-engine';
import type { SessionCtx } from './session-steps';

export interface SessionWorkspaceSetup {
  workspaceName: string;
  workingDir: string;
  sandboxLabel: string;
  agent: CodingAgent;
  selectModel: (createPage: AgentWorkspaceCreatePage) => Promise<string | undefined>;
  requiredResource?: ResourceId;
}

export interface SessionLifecycleConfig {
  describeName: string;
  tags?: string[];
  workspaceSetup: SessionWorkspaceSetup;
  steps: ScenarioStep<SessionCtx>[];
}

function provisionSessionWorkspaceStep(setup: SessionWorkspaceSetup): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-SETUP-01',
    title: `Provisions a Ready ${setup.sandboxLabel} sandbox for ACP session tests`,
    run: async ({ navigationBar, agentWorkspacesPage, agentSessionsPage }): Promise<void> => {
      await navigationBar.ensureExtensionsRunning();
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(setup.workspaceName);

      const createPage = await agentWorkspacesPage.openCreatePage();
      await createPage.sessionNameInput.fill(setup.workspaceName);
      await createPage.workingDirInput.fill(setup.workingDir);
      await createPage.continueToStep(WIZARD_STEP.AGENT_MODEL);
      await createPage.selectAgent(setup.agent);
      await createPage.waitForModelCatalog();
      await setup.selectModel(createPage);
      await createPage.continueToStep(WIZARD_STEP.TOOLS_SECRETS);
      await createPage.continueToStep(WIZARD_STEP.FILE_SYSTEM);
      await createPage.continueToStep(WIZARD_STEP.NETWORKING);
      await createPage.startWorkspace();

      await agentWorkspacesPage.expectWorkspaceCreated(setup.workspaceName);
      await agentWorkspacesPage.waitForWorkspaceStatus(
        setup.workspaceName,
        WORKSPACE_STATUS.RUNNING,
        TIMEOUTS.WORKSPACE_READY,
      );

      await navigationBar.navigateToAgentsPage();
      await expect(agentSessionsPage.createButton).toBeEnabled({ timeout: TIMEOUTS.WORKSPACE_READY });
    },
  };
}

function cleanupSessionWorkspaceStep(workspaceName: string): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-CLEANUP-01',
    title: `Removes the ${workspaceName} sandbox`,
    run: async ({ navigationBar, agentWorkspacesPage }): Promise<void> => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(workspaceName);
      await expect(agentWorkspacesPage.noWorkspacesMessage.or(agentWorkspacesPage.table)).toBeVisible();
    },
  };
}

export function registerSessionLifecycleTests(test: typeof providerTest, config: SessionLifecycleConfig): void {
  const { workspaceSetup } = config;

  const setup = async (fixtures: EngineWorkerFixtures): Promise<SessionCtx> => {
    await fixtures.workerNavigationBar.ensureExtensionsRunning();

    if (workspaceSetup.requiredResource) {
      await createRequiredResource(fixtures, workspaceSetup.requiredResource);
    }

    return { workspaceName: workspaceSetup.workspaceName, sessionLabel: '' };
  };

  const teardown = async (_ctx: SessionCtx, fixtures: EngineWorkerFixtures): Promise<void> => {
    if (workspaceSetup.requiredResource) {
      await deleteRequiredResource(fixtures, workspaceSetup.requiredResource);
    }
  };

  const steps = [
    provisionSessionWorkspaceStep(workspaceSetup),
    ...config.steps,
    cleanupSessionWorkspaceStep(workspaceSetup.workspaceName),
  ];

  test.describe
    .serial(config.describeName, { tag: config.tags }, () => {
      skipUnlessPlatformSupported(
        test,
        'ACP session tests require Podman (set PODMAN_ENABLED=true on non-Linux)',
        workspaceSetup.requiredResource,
      );
      registerScenarioLifecycleTests(test, { setup, teardown, steps });
    });
}
