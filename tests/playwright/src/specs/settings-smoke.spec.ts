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
import { GuidedSetupPage } from '/@/model/pages/guided-setup-page';
import { describeAgentOnboarding } from '/@/model/pages/guided-setup-workflow';
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

  test('[SET-10] Models tab categories and token-based search', async ({ settingsPage }) => {
    const modelsPage = await settingsPage.openModels();

    await test.step('category sidebar is visible with all categories', async () => {
      await expect(modelsPage.categoryNav).toBeVisible();
      for (const label of ['LLM Providers', 'In-house', 'Local', 'Semantic Routers']) {
        await expect(modelsPage.getCategoryButton(label)).toBeVisible();
      }
    });

    await test.step('search input is visible and accepts input', async () => {
      await expect(modelsPage.searchInput).toBeVisible();
    });

    await test.step('token-based search filters model rows', async () => {
      // Ensure we are on the default cloud category
      await modelsPage.selectCategory('LLM Providers');

      const labels = await modelsPage.getModelLabels();

      if (labels.length === 0) {
        test.skip(true, 'No cloud models available — token-based search cannot be verified');
        return;
      }

      const totalCount = labels.length;

      // Pick the first model label and split it into two non-adjacent tokens
      // separated by a space to exercise the multi-token search.
      const label = labels[0]!;
      const tokens = label.split(/[-_]/);
      const query = tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : label;

      await modelsPage.searchModels(query);

      // The search should keep at least the model whose label produced the
      // query and may hide others, so the count must be > 0 and <= total.
      const filteredCount = await modelsPage.getModelRowCount();
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThanOrEqual(totalCount);

      // Clear the search and verify the full list is restored.
      await modelsPage.clearSearch();
      const restoredCount = await modelsPage.getModelRowCount();
      expect(restoredCount).toBe(totalCount);
    });
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

  describeAgentOnboarding(CODING_AGENT.CODEX, 'Codex', () => {
    const session = bindGuidedSetupSession();

    isolatedTest('[SET-09] persists a newly selected default model', async () => {
      const guidedSetup = new GuidedSetupPage(session.page!);
      const navigationBar = new NavigationBar(session.page!);

      const initialOnboardingRestart = await completeGuidedSetupWithModel(
        guidedSetup,
        CODING_AGENT.CODEX,
        labels => labels.at(-1)!,
      );
      await expectDefaultModelInCodingAgents(navigationBar, CODING_AGENT.CODEX, initialOnboardingRestart.modelLabel);

      await restartOnboarding(navigationBar, guidedSetup);

      const updatedOnboardingRestart = await completeGuidedSetupWithModel(
        guidedSetup,
        CODING_AGENT.CODEX,
        labels =>
          labels.find(label => label !== initialOnboardingRestart.modelLabel) ?? initialOnboardingRestart.modelLabel,
      );
      await expectDefaultModelInCodingAgents(navigationBar, CODING_AGENT.CODEX, updatedOnboardingRestart.modelLabel);

      if (updatedOnboardingRestart.availableModelCount > 1) {
        expect(updatedOnboardingRestart.modelLabel).not.toBe(initialOnboardingRestart.modelLabel);
      }
    });
  });
});
