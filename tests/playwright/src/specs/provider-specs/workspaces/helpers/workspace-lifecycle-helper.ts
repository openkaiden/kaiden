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
 * Shared lifecycle for Coding Agent Workspace provider E2E tests.
 * See .agents/skills/playwright-testing/scenario-lifecycle-e2e.md
 ***********************************************************************/

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Expect } from '@playwright/test';

import type { test as providerTest } from '/@/fixtures/provider-fixtures';
import {
  type CodingAgent,
  FILE_ACCESS_LEVEL,
  type FileAccessLevel,
  type NetworkAccessLevel,
  type ResourceId,
  TIMEOUTS,
  WIZARD_STEP,
  WORKSPACE_STATUS,
  type WorkspaceCustomMount,
} from '/@/model/core/types';
import type { AgentWorkspaceCreatePage } from '/@/model/pages/agent-workspace-create-page';

import {
  createRequiredResource,
  deleteRequiredResource,
  type EngineWorkerFixtures,
  registerScenarioLifecycleTests,
  type ScenarioStep,
  skipUnlessPlatformSupported,
} from './scenario-lifecycle-engine';

export interface WorkspaceSandboxOptions {
  fileAccess: FileAccessLevel;
  network: NetworkAccessLevel;
  customMounts?: WorkspaceCustomMount[];
  denyHosts?: string[];
  additionalHosts?: string[];
  summary: string;
}

export interface WorkspaceLifecycleConfig {
  testIdPrefix: string;
  /** Sandbox matrix scenario ID (e.g. FS-NONE-NET-DEVELOPER) for short step titles. */
  scenarioId?: string;
  workspaceName: string;
  agent: CodingAgent;
  requiredResource?: ResourceId;
  selectModel: (createPage: AgentWorkspaceCreatePage) => Promise<string | undefined>;
  terminalReadyPatterns: readonly RegExp[];
  prePrompts?: { command: string; expectedResponse: RegExp }[];
  promptTimeout?: number;
  promptTest: {
    prompt: string;
    expectedResponse: RegExp;
  };
  /** When set, configures filesystem/network wizard steps and skips stat-card assertions. */
  sandbox?: WorkspaceSandboxOptions;
  /** When false, caller owns create/delete (sandbox matrix agent scope). Default true. */
  manageResource?: boolean;
  /** When true, creates the workspace without a project folder (sourcePath left empty). */
  noProjectFolder?: boolean;
}

interface WorkspaceCtx {
  workingDir?: string;
  mountDirs: string[];
  countsBefore?: { activeSessions: number; totalSessions: number; configuredAgents: number };
}

const SANDBOX_STEP_LABELS: Record<string, string> = {
  '01': 'creation',
  '02': 'running status check',
  '03': 'terminal navigation',
  '04': 'terminal prompt response',
  '05': 'removal',
};

/** Mirrors the original lifecycleStepTitle/sandboxStepTitle split: sandbox-matrix runs get
 * short numeric IDs with fixed labels; standalone provider suites get testIdPrefix-based IDs. */
function stepIdAndTitle(
  config: WorkspaceLifecycleConfig,
  step: string,
  legacyTitle: string,
): { id: string; title: string } {
  if (config.sandbox && config.scenarioId) {
    return { id: step, title: SANDBOX_STEP_LABELS[step] ?? step };
  }
  return { id: `${config.testIdPrefix}-${step}`, title: legacyTitle };
}

function buildStep(
  config: WorkspaceLifecycleConfig,
  step: string,
  legacyTitle: string,
  run: ScenarioStep<WorkspaceCtx>['run'],
): ScenarioStep<WorkspaceCtx> {
  return { ...stepIdAndTitle(config, step, legacyTitle), run };
}

export function registerWorkspaceLifecycleTests(
  test: typeof providerTest,
  expect: Expect,
  config: WorkspaceLifecycleConfig,
): void {
  const hasSandbox = config.sandbox !== undefined;

  skipUnlessPlatformSupported(
    test,
    'Workspace tests require Podman (set PODMAN_ENABLED=true on non-Linux)',
    config.requiredResource,
  );

  const stepNumbers = hasSandbox
    ? { terminal: '03', prompt: '04', remove: '05' }
    : { statAfterCreate: '03', terminal: '04', prompt: '05', remove: '06', statAfterRemove: '07' };

  const manageResource = config.manageResource !== false;

  const setup = async (fixtures: EngineWorkerFixtures): Promise<WorkspaceCtx> => {
    await fixtures.workerNavigationBar.ensureExtensionsRunning();

    if (manageResource && config.requiredResource) {
      await createRequiredResource(fixtures, config.requiredResource);
    }

    const ctx: WorkspaceCtx = { mountDirs: [] };

    if (!config.noProjectFolder) {
      ctx.workingDir = mkdtempSync(join(homedir(), '.kdn-e2e-'));
    }

    if (
      hasSandbox &&
      config.sandbox!.fileAccess === FILE_ACCESS_LEVEL.CUSTOM_PATHS &&
      config.sandbox!.customMounts?.length
    ) {
      ctx.mountDirs = config.sandbox!.customMounts.map(mount =>
        mount.host === '' ? mkdtempSync(join(homedir(), '.kdn-e2e-mount-')) : '',
      );

      for (const mount of config.sandbox!.customMounts) {
        if (mount.host.startsWith('$SOURCES/')) {
          mkdirSync(join(ctx.workingDir!, mount.host.slice('$SOURCES/'.length)), { recursive: true });
        }
      }
    }

    return ctx;
  };

  const teardown = async (ctx: WorkspaceCtx, fixtures: EngineWorkerFixtures): Promise<void> => {
    for (const mountDir of ctx.mountDirs) {
      if (mountDir) {
        rmSync(mountDir, { recursive: true, force: true });
      }
    }
    if (ctx.workingDir) {
      rmSync(ctx.workingDir, { recursive: true, force: true });
    }
    if (manageResource && config.requiredResource) {
      await deleteRequiredResource(fixtures, config.requiredResource);
    }
  };

  const createStepTitle = hasSandbox ? `Creates a workspace with ${config.sandbox!.summary}` : 'Creates a workspace';

  const createStep = buildStep(config, '01', createStepTitle, async (fixtures, ctx) => {
    const { navigationBar, agentWorkspacesPage } = fixtures;
    if (hasSandbox) {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(config.workspaceName);
    } else {
      await navigationBar.navigateToWorkspacesPage();
      await navigationBar.navigateToSettingsPage();
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(config.workspaceName);
      ctx.countsBefore = await agentWorkspacesPage.getStatCounts();
    }

    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.sessionNameInput.fill(config.workspaceName);
    if (!config.noProjectFolder) {
      await createPage.workingDirInput.fill(ctx.workingDir!);
    }
    await createPage.continueToStep(WIZARD_STEP.AGENT_MODEL);

    await createPage.selectAgent(config.agent);
    await createPage.waitForModelCatalog();
    await config.selectModel(createPage);

    if (hasSandbox) {
      const customMounts =
        config.sandbox!.fileAccess === FILE_ACCESS_LEVEL.CUSTOM_PATHS && ctx.mountDirs.length
          ? config.sandbox!.customMounts!.map((mount, index) =>
              mount.host === '' ? { ...mount, host: ctx.mountDirs[index]! } : mount,
            )
          : config.sandbox!.customMounts;

      await createPage.completeSandboxWizardSteps({
        fileAccess: config.sandbox!.fileAccess,
        customMounts,
        network: config.sandbox!.network,
        denyHosts: config.sandbox!.denyHosts,
        additionalHosts: config.sandbox!.additionalHosts,
      });
      await createPage.startWorkspace();
      await agentWorkspacesPage.expectWorkspaceCreated(config.workspaceName);
    } else {
      await createPage.continueToStep(WIZARD_STEP.TOOLS_SECRETS);
      await createPage.continueToStep(WIZARD_STEP.FILE_SYSTEM);
      await createPage.continueToStep(WIZARD_STEP.NETWORKING);
      await createPage.startWorkspace();
      await expect(agentWorkspacesPage.heading).toBeVisible({ timeout: TIMEOUTS.WORKSPACE_READY });
    }
  });

  const runningStatusStep = buildStep(
    config,
    '02',
    'Workspace appears with Running status',
    async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.ensureRowExists(config.workspaceName, TIMEOUTS.WORKSPACE_READY);
      await agentWorkspacesPage.waitForWorkspaceStatus(
        config.workspaceName,
        WORKSPACE_STATUS.RUNNING,
        TIMEOUTS.WORKSPACE_READY,
      );
    },
  );

  const terminalStep = buildStep(
    config,
    stepNumbers.terminal,
    'Terminal shows agent is loaded',
    async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.navigateToWorkspacesPage();
      const detailsPage = await agentWorkspacesPage.openWorkspaceTerminal(config.workspaceName);
      const terminalPage = detailsPage.getTerminalPage();
      for (const pattern of config.terminalReadyPatterns) {
        await terminalPage.waitForTerminalContent(pattern, TIMEOUTS.MODEL_RESPONSE);
      }
    },
  );

  const promptStep = buildStep(
    config,
    stepNumbers.prompt,
    'Sends a prompt and receives a response',
    async ({ navigationBar, agentWorkspacesPage }) => {
      const promptTimeout = config.promptTimeout ?? TIMEOUTS.MODEL_RESPONSE;
      await navigationBar.navigateToWorkspacesPage();
      const detailsPage = await agentWorkspacesPage.openWorkspaceTerminal(config.workspaceName);
      const terminalPage = detailsPage.getTerminalPage();

      await terminalPage.waitForTerminalContent(config.terminalReadyPatterns[0]!, TIMEOUTS.MODEL_RESPONSE);

      if (config.prePrompts) {
        for (const pre of config.prePrompts) {
          await terminalPage.sendPrompt({
            prompt: pre.command,
            expectedResponse: pre.expectedResponse,
            timeout: TIMEOUTS.STANDARD,
          });
        }
      }

      await terminalPage.sendPrompt({
        prompt: config.promptTest.prompt,
        expectedResponse: config.promptTest.expectedResponse,
        timeout: promptTimeout,
      });
    },
  );

  const removeStep = buildStep(
    config,
    stepNumbers.remove,
    'Removes the workspace',
    async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspace(config.workspaceName);
      await expect(agentWorkspacesPage.noWorkspacesMessage.or(agentWorkspacesPage.table)).toBeVisible();
    },
  );

  const steps: ScenarioStep<WorkspaceCtx>[] = [createStep, runningStatusStep];

  if (!hasSandbox) {
    steps.push({
      id: `${config.testIdPrefix}-${stepNumbers.statAfterCreate}`,
      title: 'Stat cards reflect the new workspace',
      run: async ({ navigationBar, agentWorkspacesPage }, ctx): Promise<void> => {
        await navigationBar.navigateToWorkspacesPage();
        await agentWorkspacesPage.waitForStatCounts({
          totalSessions: ctx.countsBefore!.totalSessions + 1,
          activeSessions: ctx.countsBefore!.activeSessions + 1,
        });
        const countsAfter = await agentWorkspacesPage.getStatCounts();
        expect(countsAfter.configuredAgents).toBeGreaterThanOrEqual(ctx.countsBefore!.configuredAgents);
      },
    });
  }

  steps.push(terminalStep, promptStep, removeStep);

  if (!hasSandbox) {
    steps.push({
      id: `${config.testIdPrefix}-${stepNumbers.statAfterRemove}`,
      title: 'Stat cards reflect workspace removal',
      run: async ({ navigationBar, agentWorkspacesPage }, ctx): Promise<void> => {
        await navigationBar.navigateToWorkspacesPage();
        await agentWorkspacesPage.waitForStatCounts({
          totalSessions: ctx.countsBefore!.totalSessions,
          activeSessions: ctx.countsBefore!.activeSessions,
        });
      },
    });
  }

  registerScenarioLifecycleTests(test, { setup, teardown, steps });
}
