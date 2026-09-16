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

import { bindGuidedSetupSession, expect, test } from '/@/fixtures/guided-setup-fixture';
import { CODING_AGENT, ENABLED_CODING_AGENTS, WIZARD_STEP } from '/@/model/core/types';
import { NavigationBar } from '/@/model/navigation/navigation';
import { isLocalRuntimeAvailable, resolveAgentModelConnectionFor } from '/@/model/pages/agent-model-setup';
import { AgentWorkspacesPage } from '/@/model/pages/agent-workspaces-page';
import { GuidedSetupPage } from '/@/model/pages/guided-setup-page';
import {
  completeGuidedSetupFor,
  describeAgentOnboarding,
  describeIfAvailable,
  expectDefaultsInWorkspaceWizard,
} from '/@/model/pages/guided-setup-workflow';

const candidateModels = [process.env.INFERENCE_MODEL, process.env.INFERENCE_SECOND_MODEL].filter(
  (model): model is string => Boolean(model),
);

test.describe('Guided setup smoke', { tag: '@smoke' }, () => {
  describeAgentOnboarding(CODING_AGENT.OPENCODE, 'OpenCode onboarding', () => {
    test.describe('Onboarding - wizard (one app)', () => {
      test.describe.configure({ mode: 'serial' });
      const session = bindGuidedSetupSession();

      test('[OGS-FLOW-01] Guided setup wizard shows enabled agents and model catalog', async () => {
        const guidedSetup = new GuidedSetupPage(session.page!);
        await expect(guidedSetup.welcomePage).toBeVisible();
        await guidedSetup.waitForWelcomeFooterReady();
        await expect(guidedSetup.startGuidedSetupButton).toBeEnabled();
        await guidedSetup.startFromWelcome();
        await guidedSetup.expectCodingAgentStepVisible();
        for (const agent of ENABLED_CODING_AGENTS) {
          await expect(guidedSetup.getAgentCard(agent)).toBeVisible();
        }
        const modelCount = await guidedSetup.waitForModelCatalogReady();
        test.skip(modelCount === 0, 'No compatible models available');
      });

      test('[OGS-FLOW-04] Guided setup model step updates on agent switch and shows Claude providers', async () => {
        const guidedSetup = new GuidedSetupPage(session.page!);
        await guidedSetup.expectLoaded();
        await guidedSetup.expectBackDisabled();
        await guidedSetup.selectAgent(CODING_AGENT.OPENCODE);
        await guidedSetup.expectDefaultModelHeading(CODING_AGENT.OPENCODE);
        const modelCount = await guidedSetup.waitForModelCatalogReady();
        test.skip(modelCount === 0, 'No compatible models available');

        await guidedSetup.selectAgent(CODING_AGENT.CLAUDE);
        await guidedSetup.expectDefaultModelHeading(CODING_AGENT.CLAUDE);
        if (resolveAgentModelConnectionFor(CODING_AGENT.CLAUDE)) {
          return;
        }

        test.skip(!(await guidedSetup.isProviderPickerVisible()), 'Claude provider picker is not available');
        await guidedSetup.expectProviderOptionVisible('Claude');
        if (await guidedSetup.isProviderOptionVisible('Vertex AI')) {
          await guidedSetup.expectProviderOptionVisible('Vertex AI');
        }
        await guidedSetup.selectProviderOption('Claude');
      });
    });

    test.describe('Onboarding - complete OpenCode (one app)', () => {
      test.describe.configure({ mode: 'serial' });
      const session = bindGuidedSetupSession();

      test('[OGS-FLOW-02] Guided setup onboarding completes for OpenCode and reaches dashboard', async () => {
        const guidedSetup = new GuidedSetupPage(session.page!);
        await guidedSetup.startFromWelcome();
        await guidedSetup.completeAgentModelFor(CODING_AGENT.OPENCODE);
        await guidedSetup.complete();
        await guidedSetup.expectDashboardVisible();
      });
    });

    test.describe('Onboarding - skip flow (one app)', () => {
      test.describe.configure({ mode: 'serial' });
      const session = bindGuidedSetupSession();

      test('[OGS-FLOW-03] Skipping guided setup onboarding keeps workspace wizard defaults', async () => {
        const guidedSetup = new GuidedSetupPage(session.page!);
        await guidedSetup.startFromWelcome();
        await guidedSetup.selectAgent(CODING_AGENT.OPENCODE);
        const modelCount = await guidedSetup.waitForModelCatalogReady();
        test.skip(modelCount === 0, 'No compatible models for OpenCode');
        const modelLabels = await guidedSetup.getModelLabels();

        await guidedSetup.selectModelByLabel(modelLabels.at(-1)!);
        await guidedSetup.selectAgent(CODING_AGENT.CLAUDE);
        await guidedSetup.skip();

        const navigationBar = new NavigationBar(session.page!);
        const agentWorkspacesPage = new AgentWorkspacesPage(session.page!);
        await navigationBar.navigateToWorkspacesPage();
        const createPage = await agentWorkspacesPage.openCreatePage();
        await createPage.workingDirInput.fill('/tmp/guide-skip-test');
        await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);
        await createPage.expectAgentSelected(CODING_AGENT.OPENCODE);
        expect(await createPage.getSelectedModelLabel()).toBe(modelLabels[0]);
      });
    });

    test.describe('Onboarding - guided setup persistence (OpenCode)', () => {
      test.describe.configure({ mode: 'serial' });

      for (const modelLabel of candidateModels) {
        test.describe(`model: ${modelLabel}`, () => {
          const session = bindGuidedSetupSession();

          test(`[OGS-PERSIST-01] Guided setup persistence: ${modelLabel} appears in workspace wizard`, async () => {
            const guidedSetup = new GuidedSetupPage(session.page!);
            await guidedSetup.startFromWelcome();
            await guidedSetup.completeAgentModelFor(CODING_AGENT.OPENCODE);
            test.skip(!(await guidedSetup.isModelVisible(modelLabel)), `${modelLabel} is not compatible with OpenCode`);

            await guidedSetup.selectModelByLabel(modelLabel);
            await guidedSetup.complete();
            await expectDefaultsInWorkspaceWizard(session.page!, CODING_AGENT.OPENCODE, modelLabel);
          });
        });
      }

      test.describe('default model', () => {
        const session = bindGuidedSetupSession();

        test('[OGS-PERSIST-02] Guided setup persistence: OpenCode model appears in workspace wizard', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          const persistedModel = await completeGuidedSetupFor(guidedSetup, CODING_AGENT.OPENCODE);
          await expectDefaultsInWorkspaceWizard(session.page!, CODING_AGENT.OPENCODE, persistedModel);
        });
      });
    });
  });

  describeAgentOnboarding(CODING_AGENT.CLAUDE, 'Claude Code onboarding', () => {
    test.describe('Onboarding - complete Claude Code (one app)', () => {
      test.describe.configure({ mode: 'serial' });
      const session = bindGuidedSetupSession();

      test('[OGS-FLOW-02] Guided setup onboarding completes for Claude Code and reaches dashboard', async () => {
        const guidedSetup = new GuidedSetupPage(session.page!);
        await guidedSetup.startFromWelcome();
        await guidedSetup.completeAgentModelFor(CODING_AGENT.CLAUDE);
        await guidedSetup.complete();
        await guidedSetup.expectDashboardVisible();
      });
    });

    test.describe('Onboarding - guided setup persistence (Claude)', () => {
      test.skip(
        !!process.env.GITHUB_ACTIONS && process.platform !== 'linux' && !process.env.PODMAN_ENABLED,
        'Requires an OpenShell gateway with the Podman driver, which is not available on macOS/Windows GitHub Actions runners',
      );

      const session = bindGuidedSetupSession();

      test('[OGS-PERSIST-03] Guided setup persistence: Claude model appears in workspace wizard', async () => {
        const guidedSetup = new GuidedSetupPage(session.page!);
        const selectedModel = await completeGuidedSetupFor(guidedSetup, CODING_AGENT.CLAUDE);
        await expectDefaultsInWorkspaceWizard(session.page!, CODING_AGENT.CLAUDE, selectedModel);
      });
    });
  });

  describeAgentOnboarding(CODING_AGENT.COPILOT, 'GitHub Copilot onboarding', () => {
    describeIfAvailable(
      isLocalRuntimeAvailable(),
      'local model',
      'OLLAMA_ENABLED or RAMALAMA_ENABLED is required for this test',
      () => {
        test.skip(
          !!process.env.GITHUB_ACTIONS && process.platform !== 'linux' && !process.env.PODMAN_ENABLED,
          'Requires an OpenShell gateway with the Podman driver, which is not available on macOS/Windows GitHub Actions runners',
        );

        const session = bindGuidedSetupSession();

        test('[OGS-FLOW-02] Guided setup onboarding completes for GitHub Copilot (local model) and reaches dashboard', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          await guidedSetup.startFromWelcome();
          await guidedSetup.completeAgentModelFor(CODING_AGENT.COPILOT);
          await guidedSetup.complete();
          await guidedSetup.expectDashboardVisible();
        });
      },
    );

    describeIfAvailable(
      !!resolveAgentModelConnectionFor(CODING_AGENT.COPILOT, 'openai'),
      'API provider (OpenAI)',
      'OPENAI_API_KEY is required for this test',
      () => {
        const session = bindGuidedSetupSession();

        test('[OGS-FLOW-02] Guided setup onboarding completes for GitHub Copilot (OpenAI) and reaches dashboard', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          await guidedSetup.startFromWelcome();
          await guidedSetup.completeAgentModelFor(CODING_AGENT.COPILOT, 'openai');
          await guidedSetup.complete();
          await guidedSetup.expectDashboardVisible();
        });
      },
    );

    describeIfAvailable(
      !!resolveAgentModelConnectionFor(CODING_AGENT.COPILOT, 'claude'),
      'API provider (Claude)',
      'ANTHROPIC_API_KEY is required for this test',
      () => {
        const session = bindGuidedSetupSession();

        test('[OGS-FLOW-02] Guided setup onboarding completes for GitHub Copilot (Claude) and reaches dashboard', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          await guidedSetup.startFromWelcome();
          await guidedSetup.completeAgentModelFor(CODING_AGENT.COPILOT, 'claude');
          await guidedSetup.complete();
          await guidedSetup.expectDashboardVisible();
        });
      },
    );
  });
});
