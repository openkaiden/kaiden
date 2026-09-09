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
import { BADGE_TEXT, builtInExtensions, ExtensionStatus, State } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

test.describe.serial('Extensions page navigation', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToExtensionsPage();
  });

  test('[EXT-01] Extension navigation tabs are accessible', async ({ extensionsPage }) => {
    const tabs = extensionsPage.getAllTabs();
    const expectedTabCount = 3; // Installed, Catalog, Local Extensions

    expect(tabs).toHaveLength(expectedTabCount);

    for (const tab of tabs) {
      await expect(tab).toBeVisible();
      await expect(tab).toBeEnabled();
    }
  });

  test('[EXT-02] Search functionality filters extensions correctly', async ({ extensionsPage }) => {
    for (const extension of builtInExtensions) {
      await extensionsPage.searchExtension(extension.name);
      await extensionsPage.verifySearchResults(extension.locator);
      await extensionsPage.clearSearch();
    }
  });

  test('[EXT-03] Built-in extensions are visible with correct badges', async ({ extensionsPage }) => {
    const installedPage = await extensionsPage.openInstalledTab();

    for (const extension of builtInExtensions) {
      const extensionLocator = installedPage.getExtension(extension.locator);
      await expect(extensionLocator).toBeVisible();

      const badge = installedPage.getExtensionBadge(extension.locator);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(BADGE_TEXT);
    }
  });

  test('[EXT-04] Built-in extensions delete button is always disabled and unaffected by toggling', async ({
    extensionsPage,
  }) => {
    const installedPage = await extensionsPage.openInstalledTab();

    for (const extension of builtInExtensions) {
      const deleteButton = installedPage.getDeleteButtonForExtension(extension.locator);
      await expect(deleteButton).toBeVisible();
      await expect(deleteButton).toBeDisabled();
    }

    const testExtension = builtInExtensions[0];
    const deleteButton = installedPage.getDeleteButtonForExtension(testExtension.locator);
    const initialState = await installedPage.getExtensionState(testExtension.locator);

    try {
      await installedPage.toggleExtensionState(testExtension.locator);
      await expect(deleteButton).toBeDisabled();
    } finally {
      const currentState = await installedPage.getExtensionState(testExtension.locator);
      if (currentState !== initialState) {
        await installedPage.toggleExtensionState(testExtension.locator);
      }
    }
    await expect(deleteButton).toBeDisabled();
  });

  test('[EXT-05] Extension details page reflects the installed extension state', async ({
    extensionsPage,
    navigationBar,
  }) => {
    for (const extension of builtInExtensions) {
      const installedPage = await extensionsPage.openInstalledTab();
      const installedState = await installedPage.getExtensionState(extension.locator);
      const detailsPage = await installedPage.openExtensionDetails(extension);

      await expect(detailsPage.heading).toBeVisible();
      await expect(detailsPage.status).toHaveText(
        installedState === ExtensionStatus.RUNNING ? State.ACTIVE : State.DISABLED,
      );
      await expect(detailsPage.deleteButton).toBeDisabled();

      await navigationBar.navigateToExtensionsPage();
    }
  });

  test('[EXT-06] Start/Stop controls toggle visibility in sync with extension status', async ({ extensionsPage }) => {
    const installedPage = await extensionsPage.openInstalledTab();
    const extension = builtInExtensions[0];
    const startButton = installedPage.getStartButtonForExtension(extension.locator);
    const stopButton = installedPage.getStopButtonForExtension(extension.locator);

    const initialState = await installedPage.getExtensionState(extension.locator);

    try {
      await installedPage.toggleExtensionState(extension.locator);
      const toggledState = await installedPage.getExtensionState(extension.locator);
      expect(toggledState).not.toBe(initialState);

      if (toggledState === ExtensionStatus.RUNNING) {
        await expect(stopButton).toBeVisible();
        await expect(startButton).not.toBeVisible();
      } else {
        await expect(startButton).toBeVisible();
        await expect(stopButton).not.toBeVisible();
      }
    } finally {
      const currentState = await installedPage.getExtensionState(extension.locator);
      if (currentState !== initialState) {
        await installedPage.toggleExtensionState(extension.locator);
      }
    }

    expect(await installedPage.getExtensionState(extension.locator)).toBe(initialState);
  });

  test('[EXT-07] Built-in extensions are marked pre-installed, and a search narrows the installed list', async ({
    extensionsPage,
  }) => {
    const installedPage = await extensionsPage.openInstalledTab();

    for (const extension of builtInExtensions) {
      await expect(installedPage.getPreInstalledLabel(extension.locator)).toBeVisible();
    }

    const extension = builtInExtensions[0];
    await extensionsPage.searchExtension(extension.name);
    await expect(extensionsPage.filteredOutIndicator).toBeVisible();

    await extensionsPage.clearSearch();
    await expect(extensionsPage.filteredOutIndicator).not.toBeVisible();
  });

  test('[EXT-08] Install Custom Extension modal validates the OCI image field', async ({ extensionsPage }) => {
    const modal = await extensionsPage.openInstallCustomExtensionModal();

    await modal.fillImageName('quay.io/namespace/my-image');
    await expect(modal.missingNameError).not.toBeVisible();
    await expect(modal.installButton).toBeEnabled();

    await modal.fillImageName('');
    await expect(modal.missingNameError).toBeVisible();
    await expect(modal.imageNameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(modal.installButton).toBeDisabled();

    await modal.cancel();
  });

  test('[EXT-09] Installed tab search with no matches shows reset-filter empty screen', async ({ extensionsPage }) => {
    const installedPage = await extensionsPage.openInstalledTab();
    const searchTerm = 'zzz-nonexistent-extension-zzz';

    await extensionsPage.searchExtension(searchTerm);
    await expect(installedPage.noSearchResultsHeading).toBeVisible();

    await installedPage.clearFilterButton.click();
    await expect(extensionsPage.searchField).toHaveValue('');
    await expect(installedPage.getExtension(builtInExtensions[0].locator)).toBeVisible();
  });
});
