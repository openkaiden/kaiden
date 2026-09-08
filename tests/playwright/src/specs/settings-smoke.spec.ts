/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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
import { expect, workerTest as test } from '/@/fixtures/electron-app';
import { bindGuidedSetupSession, test as isolatedTest } from '/@/fixtures/guided-setup-fixture';
import {
  CODING_AGENT,
  featuredResources,
  preferenceOptions,
  proxyConfigurations,
  resourcesWithCreateButton,
} from '/@/model/core/types';
import { NavigationBar } from '/@/model/navigation/navigation';
import { isLocalRuntimeAvailable, resolveAgentModelConnectionFor } from '/@/model/pages/agent-model-setup';
import { GuidedSetupPage } from '/@/model/pages/guided-setup-page';
import { describeAgentOnboarding, describeIfAvailable } from '/@/model/pages/guided-setup-workflow';
import {
  completeGuidedSetupWithModel,
  expectDefaultModelInCodingAgents,
  restartOnboarding,
} from '/@/model/pages/onboarding-restart-workflow';
import { waitForNavigationReady } from '/@/utils/app-ready';

const OPENSHELL_BUNDLED_TOOLS = ['OpenShell', 'OpenShell Image Builder', 'OpenShell Gateway'];
const OPENSHELL_TOOLS_WITH_UNINSTALL = ['OpenShell', 'OpenShell Image Builder'];

test.describe('Settings page navigation', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.ensureExtensionsRunning();
    await navigationBar.navigateToSettingsPage();
  });

  test('[SET-01] All settings tabs are visible', async ({ settingsPage }) => {
    const tabs = settingsPage.getAllTabs();
    const expectedTabCount = 6; // Resources, CLI, Proxy, Coding agents, Models, Preferences

    expect(tabs).toHaveLength(expectedTabCount);

    for (const tab of tabs) {
      await expect(tab).toBeVisible();
    }
  });

  test('[SET-02] Resources tab shows all providers with create buttons', async ({ settingsPage }) => {
    const resourcesPage = await settingsPage.openResources();

    for (const resourceId of featuredResources) {
      await expect(resourcesPage.getResourceRegion(resourceId)).toBeVisible();
    }

    for (const displayName of resourcesWithCreateButton) {
      const createButton = resourcesPage.getResourceCreateButton(displayName);
      await expect(createButton).toBeVisible();
      await expect(createButton).toBeEnabled();
    }
  });

  test('[SET-03] CLI tab shows the bundled OpenShell tools with a detected version', async ({ settingsPage }) => {
    test.skip(process.platform === 'win32', 'OpenShell CLI binaries are not bundled for Windows yet');

    const cliPage = await settingsPage.openCli();
    await cliPage.waitForLoad();

    for (const displayName of OPENSHELL_BUNDLED_TOOLS) {
      await test.step(displayName, async () => {
        await expect(cliPage.getToolRow(displayName)).toBeVisible();

        const versionLabel = cliPage.getToolVersion(displayName);
        await expect(versionLabel).toBeVisible();
        expect(await cliPage.isToolVersionDetected(displayName)).toBeTruthy();

        test.info().annotations.push({ type: displayName, description: (await versionLabel.textContent()) ?? '' });

        if (OPENSHELL_TOOLS_WITH_UNINSTALL.includes(displayName)) {
          const uninstallButton = cliPage.getToolUninstallButton(displayName);
          await expect(uninstallButton).toBeVisible();
          await expect(uninstallButton).toBeEnabled();
        }
      });
    }
  });

  test('[SET-04] Proxy tab configurations and fields', async ({ settingsPage }) => {
    const proxyPage = await settingsPage.openProxy();
    await proxyPage.verifyProxyConfigurationOptions();
    const proxyFields = proxyPage.getProxyFields();
    expect(proxyFields.length).toBeGreaterThan(0);

    for (const field of proxyFields) {
      await expect(field).toBeVisible();
    }

    for (const config of proxyConfigurations) {
      await proxyPage.selectProxyConfigurationAndVerifyFields(config.option, config.editable);
    }
  });

  test('[SET-05] Preferences submenu items are visible and can be interacted with', async ({ settingsPage }) => {
    const preferencesPage = await settingsPage.openPreferences();
    const options = preferenceOptions();
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      await preferencesPage.selectPreference(option);
      await expect(preferencesPage.getPreferenceContent(option)).toBeVisible();
    }
  });

  test('[SET-06] Preferences search filters options correctly', async ({ settingsPage }) => {
    const preferencesPage = await settingsPage.openPreferences();
    const options = preferenceOptions();
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      await preferencesPage.searchPreferences(option);
      await expect(preferencesPage.getPreferenceContent(option)).toBeVisible();
      await preferencesPage.clearSearch();
    }
  });
});

isolatedTest.describe('Settings - onboarding restart', { tag: '@smoke' }, () => {
  describeAgentOnboarding(CODING_AGENT.OPENCODE, 'OpenCode', () => {
    const session = bindGuidedSetupSession();

    isolatedTest('[SET-07] persists a newly selected default model', async () => {
      const guidedSetup = new GuidedSetupPage(session.page!);
      const navigationBar = new NavigationBar(session.page!);

      const initialOnboardingRestart = await completeGuidedSetupWithModel(
        guidedSetup,
        CODING_AGENT.OPENCODE,
        labels => labels.at(-1)!,
      );
      await expectDefaultModelInCodingAgents(navigationBar, CODING_AGENT.OPENCODE, initialOnboardingRestart.modelLabel);

      await restartOnboarding(navigationBar, guidedSetup);

      const updatedOnboardingRestart = await completeGuidedSetupWithModel(
        guidedSetup,
        CODING_AGENT.OPENCODE,
        labels =>
          labels.find(label => label !== initialOnboardingRestart.modelLabel) ?? initialOnboardingRestart.modelLabel,
      );
      await expectDefaultModelInCodingAgents(navigationBar, CODING_AGENT.OPENCODE, updatedOnboardingRestart.modelLabel);

      // Only enough local Ollama/RamaLama models guarantee a different one was available to switch to.
      if (updatedOnboardingRestart.availableModelCount > 1) {
        expect(updatedOnboardingRestart.modelLabel).not.toBe(initialOnboardingRestart.modelLabel);
      }
    });
  });

  describeAgentOnboarding(CODING_AGENT.CLAUDE, 'Claude Code', () => {
    const claudeSession = bindGuidedSetupSession();

    isolatedTest('[SET-08] persists a newly selected default model', async () => {
      const guidedSetup = new GuidedSetupPage(claudeSession.page!);
      const navigationBar = new NavigationBar(claudeSession.page!);

      const initialOnboardingRestart = await completeGuidedSetupWithModel(
        guidedSetup,
        CODING_AGENT.CLAUDE,
        labels => labels.at(-1)!,
      );
      await expectDefaultModelInCodingAgents(navigationBar, CODING_AGENT.CLAUDE, initialOnboardingRestart.modelLabel);

      await restartOnboarding(navigationBar, guidedSetup);

      const updatedOnboardingRestart = await completeGuidedSetupWithModel(
        guidedSetup,
        CODING_AGENT.CLAUDE,
        labels =>
          labels.find(label => label !== initialOnboardingRestart.modelLabel) ?? initialOnboardingRestart.modelLabel,
      );
      await expectDefaultModelInCodingAgents(navigationBar, CODING_AGENT.CLAUDE, updatedOnboardingRestart.modelLabel);
      expect(updatedOnboardingRestart.modelLabel).not.toBe(initialOnboardingRestart.modelLabel);
    });
  });

  describeAgentOnboarding(CODING_AGENT.COPILOT, 'GitHub Copilot', () => {
    describeIfAvailable(
      isLocalRuntimeAvailable(),
      'local model',
      'OLLAMA_ENABLED or RAMALAMA_ENABLED is required for this test',
      () => {
        const session = bindGuidedSetupSession();

        isolatedTest('[SET-09] persists a newly selected default model (local model)', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          const navigationBar = new NavigationBar(session.page!);

          const initialOnboardingRestart = await completeGuidedSetupWithModel(
            guidedSetup,
            CODING_AGENT.COPILOT,
            labels => labels.at(-1)!,
          );
          await expectDefaultModelInCodingAgents(
            navigationBar,
            CODING_AGENT.COPILOT,
            initialOnboardingRestart.modelLabel,
          );

          await restartOnboarding(navigationBar, guidedSetup);

          const updatedOnboardingRestart = await completeGuidedSetupWithModel(
            guidedSetup,
            CODING_AGENT.COPILOT,
            labels =>
              labels.find(label => label !== initialOnboardingRestart.modelLabel) ??
              initialOnboardingRestart.modelLabel,
          );
          await expectDefaultModelInCodingAgents(
            navigationBar,
            CODING_AGENT.COPILOT,
            updatedOnboardingRestart.modelLabel,
          );

          // Only enough local Ollama/RamaLama models guarantee a different one was available to switch to.
          if (updatedOnboardingRestart.availableModelCount > 1) {
            expect(updatedOnboardingRestart.modelLabel).not.toBe(initialOnboardingRestart.modelLabel);
          }
        });
      },
    );

    describeIfAvailable(
      !!resolveAgentModelConnectionFor(CODING_AGENT.COPILOT, 'openai'),
      'API provider (OpenAI)',
      'OPENAI_API_KEY is required for this test',
      () => {
        const session = bindGuidedSetupSession();

        isolatedTest('[SET-10] persists a newly selected default model (OpenAI)', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          const navigationBar = new NavigationBar(session.page!);

          const initialOnboardingRestart = await completeGuidedSetupWithModel(
            guidedSetup,
            CODING_AGENT.COPILOT,
            labels => labels.at(-1)!,
            'openai',
          );
          await expectDefaultModelInCodingAgents(
            navigationBar,
            CODING_AGENT.COPILOT,
            initialOnboardingRestart.modelLabel,
          );

          await restartOnboarding(navigationBar, guidedSetup);

          const updatedOnboardingRestart = await completeGuidedSetupWithModel(
            guidedSetup,
            CODING_AGENT.COPILOT,
            labels =>
              labels.find(label => label !== initialOnboardingRestart.modelLabel) ??
              initialOnboardingRestart.modelLabel,
            'openai',
          );
          await expectDefaultModelInCodingAgents(
            navigationBar,
            CODING_AGENT.COPILOT,
            updatedOnboardingRestart.modelLabel,
          );

          if (updatedOnboardingRestart.availableModelCount > 1) {
            expect(updatedOnboardingRestart.modelLabel).not.toBe(initialOnboardingRestart.modelLabel);
          }
        });
      },
    );

    describeIfAvailable(
      !!resolveAgentModelConnectionFor(CODING_AGENT.COPILOT, 'claude'),
      'API provider (Claude)',
      'ANTHROPIC_API_KEY is required for this test',
      () => {
        const session = bindGuidedSetupSession();

        isolatedTest('[SET-10] persists a newly selected default model (Claude)', async () => {
          const guidedSetup = new GuidedSetupPage(session.page!);
          const navigationBar = new NavigationBar(session.page!);

          const initialOnboardingRestart = await completeGuidedSetupWithModel(
            guidedSetup,
            CODING_AGENT.COPILOT,
            labels => labels.at(-1)!,
            'claude',
          );
          await expectDefaultModelInCodingAgents(
            navigationBar,
            CODING_AGENT.COPILOT,
            initialOnboardingRestart.modelLabel,
          );

          await restartOnboarding(navigationBar, guidedSetup);

          const updatedOnboardingRestart = await completeGuidedSetupWithModel(
            guidedSetup,
            CODING_AGENT.COPILOT,
            labels =>
              labels.find(label => label !== initialOnboardingRestart.modelLabel) ??
              initialOnboardingRestart.modelLabel,
            'claude',
          );
          await expectDefaultModelInCodingAgents(
            navigationBar,
            CODING_AGENT.COPILOT,
            updatedOnboardingRestart.modelLabel,
          );

          if (updatedOnboardingRestart.availableModelCount > 1) {
            expect(updatedOnboardingRestart.modelLabel).not.toBe(initialOnboardingRestart.modelLabel);
          }
        });
      },
    );
  });
});
