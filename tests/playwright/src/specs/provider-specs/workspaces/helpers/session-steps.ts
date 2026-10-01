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
 * Composable ACP session lifecycle steps. See
 * .agents/skills/playwright-testing/scenario-lifecycle-e2e.md
 ***********************************************************************/

import { basename } from 'node:path';

import { expect } from '/@/fixtures/provider-fixtures';
import { PERMISSION_ACTION, TIMEOUTS } from '/@/model/core/types';
import type { NavigationBar } from '/@/model/navigation/navigation';
import type { AgentSessionDetailPage } from '/@/model/pages/agent-session-detail-page';
import type { AgentSessionsPage } from '/@/model/pages/agent-sessions-page';

import type { EngineTestFixtures, ScenarioStep } from './scenario-lifecycle-engine';

export interface SessionCtx {
  workspaceName: string;
  sessionLabel: string;
}

async function openExistingSession(
  navigationBar: NavigationBar,
  agentSessionsPage: AgentSessionsPage,
  agentSessionDetailPage: AgentSessionDetailPage,
  sessionLabel: string,
): Promise<void> {
  await navigationBar.navigateToAgentsPage();
  await agentSessionsPage.sidebar.openSession(sessionLabel);
  await agentSessionDetailPage.waitForLoad();
}

export function createSessionStep(config: {
  initialPrompt: string;
  expectedResponse?: string | RegExp;
  timeout?: number;
}): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-CREATE-01',
    title: 'Creating a session against a Ready sandbox reaches Completed with a real response',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage, agentSessionDetailPage } = fixtures;
      await navigationBar.navigateToAgentsPage();
      const createDialog = await agentSessionsPage.openCreateDialog();
      await createDialog.fillPrompt(config.initialPrompt);
      await agentSessionDetailPage.installTurnObserver();
      await createDialog.submit();
      await agentSessionDetailPage.markTurnSent();

      await agentSessionDetailPage.waitForLoad();
      await expect(agentSessionDetailPage.getPromptEvent(config.initialPrompt)).toBeVisible();

      ctx.sessionLabel = config.initialPrompt.slice(0, 40);
      await agentSessionDetailPage.waitForTurnCompletion(config.timeout ?? TIMEOUTS.MODEL_RESPONSE);

      if (config.expectedResponse) {
        await expect(agentSessionDetailPage.getFlowText(config.expectedResponse)).toBeVisible();
      }
    },
  };
}

export function followUpSessionStep(config: {
  followUpPrompt: string;
  expectedResponse?: string | RegExp;
  timeout?: number;
}): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-FOLLOWUP-01',
    title: 'Sending a follow-up in the same session appends a new response',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage, agentSessionDetailPage } = fixtures;
      await openExistingSession(navigationBar, agentSessionsPage, agentSessionDetailPage, ctx.sessionLabel);

      await agentSessionDetailPage.installTurnObserver();
      await agentSessionDetailPage.sendFollowUp(config.followUpPrompt);
      await agentSessionDetailPage.markTurnSent();
      await expect(agentSessionDetailPage.getPromptEvent(config.followUpPrompt)).toBeVisible();

      await agentSessionDetailPage.waitForTurnCompletion(config.timeout ?? TIMEOUTS.MODEL_RESPONSE);

      if (config.expectedResponse) {
        await expect(agentSessionDetailPage.getFlowText(config.expectedResponse)).toBeVisible();
      }
    },
  };
}

export function attachFileSessionStep(config: {
  file: string;
  followUpPrompt: string;
  timeout?: number;
}): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-ATTACH-01',
    title: 'Attaching a file includes it in the sent prompt',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage, agentSessionDetailPage, electronApp } = fixtures;
      await openExistingSession(navigationBar, agentSessionsPage, agentSessionDetailPage, ctx.sessionLabel);

      const fileName = basename(config.file);
      await agentSessionDetailPage.attachFile(config.file, electronApp);
      await expect(agentSessionDetailPage.getAttachmentChip(fileName)).toBeVisible();

      await agentSessionDetailPage.installTurnObserver();
      await agentSessionDetailPage.sendFollowUp(config.followUpPrompt);
      await agentSessionDetailPage.markTurnSent();
      await expect(agentSessionDetailPage.getPromptEvent(config.followUpPrompt)).toBeVisible();
      await expect(agentSessionDetailPage.getFlowText(fileName)).toBeVisible();

      await agentSessionDetailPage.waitForTurnCompletion(config.timeout ?? TIMEOUTS.MODEL_RESPONSE);
    },
  };
}

export function stopSessionStep(config: { longRunningPrompt: string; timeout?: number }): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-STOP-01',
    title: 'Stop halts a running turn and the composer returns to Send',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage, agentSessionDetailPage } = fixtures;
      await openExistingSession(navigationBar, agentSessionsPage, agentSessionDetailPage, ctx.sessionLabel);

      await agentSessionDetailPage.installStopObserver();
      await agentSessionDetailPage.sendFollowUp(config.longRunningPrompt);
      await agentSessionDetailPage.waitForStopClicked(config.timeout ?? TIMEOUTS.MODEL_RESPONSE);
      await expect(agentSessionDetailPage.sendButton).toBeVisible({ timeout: TIMEOUTS.STANDARD });
    },
  };
}

export function permissionApproveSessionStep(config: { prompt: string; timeout?: number }): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-PERMISSION-01',
    title: 'Approving a tool-call permission request lets the agent continue',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage, agentSessionDetailPage } = fixtures;
      await openExistingSession(navigationBar, agentSessionsPage, agentSessionDetailPage, ctx.sessionLabel);

      await agentSessionDetailPage.installTurnObserver();
      await agentSessionDetailPage.sendFollowUp(config.prompt);
      await agentSessionDetailPage.markTurnSent();

      await expect(agentSessionDetailPage.getPendingPermissionCard()).toBeVisible({
        timeout: config.timeout ?? TIMEOUTS.MODEL_RESPONSE,
      });
      await agentSessionDetailPage.getPermissionOption(PERMISSION_ACTION.ALLOW).click();

      await agentSessionDetailPage.waitForTurnCompletion(config.timeout ?? TIMEOUTS.MODEL_RESPONSE);
    },
  };
}

export function permissionDenySessionStep(config: { prompt: string; timeout?: number }): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-PERMISSION-02',
    title: 'Denying a tool-call permission request marks it Denied',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage, agentSessionDetailPage } = fixtures;
      await openExistingSession(navigationBar, agentSessionsPage, agentSessionDetailPage, ctx.sessionLabel);

      await agentSessionDetailPage.installTurnObserver();
      await agentSessionDetailPage.sendFollowUp(config.prompt);
      await agentSessionDetailPage.markTurnSent();

      await expect(agentSessionDetailPage.getPendingPermissionCard()).toBeVisible({
        timeout: config.timeout ?? TIMEOUTS.MODEL_RESPONSE,
      });
      await agentSessionDetailPage.getPermissionOption(PERMISSION_ACTION.DENY).click();

      await expect(agentSessionDetailPage.getFlowText('Denied')).toBeVisible({
        timeout: TIMEOUTS.STANDARD,
      });

      await agentSessionDetailPage.waitForTurnCompletion(config.timeout ?? TIMEOUTS.MODEL_RESPONSE);
    },
  };
}

export function renameSessionStep(config: { newLabel: string }): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-RENAME-01',
    title: 'Renaming a session via the sidebar pencil icon updates its displayed name',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage } = fixtures;
      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.renameSession(ctx.sessionLabel, config.newLabel);

      await expect(agentSessionsPage.sidebar.getSessionRow(config.newLabel)).toBeVisible();
      ctx.sessionLabel = config.newLabel;
    },
  };
}

export function searchFilterSessionStep(): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-ORGANIZE-01',
    title: 'Search filters the session list and clearing the filter restores it',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage } = fixtures;
      await navigationBar.navigateToAgentsPage();

      await agentSessionsPage.search(ctx.sessionLabel);
      await expect(agentSessionsPage.getSessionRowByText(ctx.sessionLabel)).toBeVisible();

      await agentSessionsPage.search('no-session-matches-this-term-xyz');
      await expect(agentSessionsPage.filteredEmptyMessage).toBeVisible();
      await expect(agentSessionsPage.clearFilterButton).toBeVisible();

      await agentSessionsPage.clearFilterButton.click();
      await expect(agentSessionsPage.filteredEmptyMessage).not.toBeVisible();
      await expect(agentSessionsPage.searchInput).toHaveValue('');
    },
  };
}

export function staleSandboxSessionStep(): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-STALE-SANDBOX-01',
    title: 'Removing the underlying sandbox marks the session read-only',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentWorkspacesPage, agentSessionsPage, agentSessionDetailPage } = fixtures;
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(ctx.workspaceName);

      await openExistingSession(navigationBar, agentSessionsPage, agentSessionDetailPage, ctx.sessionLabel);

      await expect(agentSessionDetailPage.staleSandboxBanner).toBeVisible({ timeout: TIMEOUTS.STANDARD });
      await expect(agentSessionDetailPage.followUpTextarea).not.toBeVisible();
    },
  };
}

export function deleteSessionStep(): ScenarioStep<SessionCtx> {
  return {
    id: 'ACP-DELETE-01',
    title: 'Deleting a session via the sidebar trash icon removes it',
    run: async (fixtures: EngineTestFixtures, ctx: SessionCtx): Promise<void> => {
      const { navigationBar, agentSessionsPage } = fixtures;
      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.deleteSession(ctx.sessionLabel);

      await expect(agentSessionsPage.sidebar.getSessionRow(ctx.sessionLabel)).toHaveCount(0, {
        timeout: TIMEOUTS.STANDARD,
      });
    },
  };
}
