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

import { globSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, workerTest as test } from '../fixtures/electron-app';
import type { SkillsCreatePage } from '../model/pages/skills-create-page';
import { waitForNavigationReady } from '../utils/app-ready';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_FILES = globSync(resolve(__dirname, '../../../../.agents/skills/*/SKILL.md'));
const TEST_SKILL = SKILL_FILES.find(f => f.includes('/playwright-testing/')) ?? SKILL_FILES[0] ?? '';
const TEST_SKILL_NAME = TEST_SKILL ? basename(dirname(TEST_SKILL)) : '';
const MANUAL_SKILL_CONTENT = TEST_SKILL ? readFileSync(TEST_SKILL, 'utf-8') : '';

test.describe('Skills page - initial state', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToSkillsPage();
  });

  test('[SKL-INIT-01] Skills page renders correctly with all expected elements in empty state', async ({
    skillsPage,
  }) => {
    await expect(skillsPage.heading).toBeVisible();
    await expect(skillsPage.newSkillButton).toBeVisible();
    await expect(skillsPage.newSkillButton).toBeEnabled();
    await expect(skillsPage.searchInput).toBeVisible();

    expect(await skillsPage.checkIfSkillsPageIsEmpty()).toBeTruthy();
    await expect(skillsPage.noSkillsMessage).toBeVisible();
    await expect(skillsPage.newSkillButtonFromContentRegion).toBeVisible();
    await expect(skillsPage.newSkillButtonFromContentRegion).toBeEnabled();
    await expect(skillsPage.table).not.toBeVisible();
  });

  test('[SKL-INIT-02] Create Skill dialog can be opened from either entry point and cancelled', async ({
    skillsPage,
  }) => {
    const entryPoints: Array<{ label: string; open: () => Promise<SkillsCreatePage> }> = [
      { label: 'header New Skill button', open: () => skillsPage.openCreateDialog() },
      { label: 'empty state New Skill button', open: () => skillsPage.openCreateDialogFromContentRegion() },
    ];

    for (const { label, open } of entryPoints) {
      await test.step(label, async () => {
        await skillsPage.waitForLoad();
        const createPage = await open();

        await expect(createPage.dialogHeading).toBeVisible();
        await expect(createPage.nameInput).toBeVisible();
        await expect(createPage.descriptionInput).toBeVisible();
        await expect(createPage.contentTextarea).toBeVisible();
        await expect(createPage.fileDropZone).toBeVisible();
        await expect(createPage.cancelButton).toBeEnabled();
        await expect(createPage.createButton).toBeVisible();

        await expect(createPage.createButton).toBeDisabled();

        await createPage.cancel();

        await expect(skillsPage.noSkillsMessage).toBeVisible();
      });
    }
  });
});

test.describe
  .serial('Skills page - manual creation', { tag: '@smoke' }, () => {
    const MANUAL_SKILL_NAME = 'e2e-manual-skill';
    const MANUAL_SKILL_DESCRIPTION = 'A skill created by e2e tests';

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[SKL-CRUD-01] Create a skill manually and verify it appears in the table', async ({
      navigationBar,
      skillsPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.createSkill(MANUAL_SKILL_NAME, MANUAL_SKILL_DESCRIPTION, MANUAL_SKILL_CONTENT);

      await skillsPage.waitForLoad();
      await skillsPage.ensureRowExists(MANUAL_SKILL_NAME);
      await expect(skillsPage.table).toBeVisible();
    });

    test('[SKL-CRUD-02] Created skill row displays the correct name and description', async ({
      navigationBar,
      skillsPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      const row = await skillsPage.getRowLocatorByName(MANUAL_SKILL_NAME);
      await expect(row).toContainText(MANUAL_SKILL_NAME);
      await expect(row).toContainText(MANUAL_SKILL_DESCRIPTION);
    });

    test('[SKL-CRUD-03] Searching by skill name filters the list to matching results', async ({
      navigationBar,
      skillsPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.search(MANUAL_SKILL_NAME);
      await expect.poll(async () => await skillsPage.countRowsFromTable()).toBe(1);
    });

    test('[SKL-CRUD-04] Searching for a non-existent skill name shows the no-results state', async ({
      navigationBar,
      skillsPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.search('non-existent-skill');
      await expect(skillsPage.filteredEmptyMessage).toBeVisible();
      await expect(skillsPage.clearFilterButton).toBeVisible();
      await skillsPage.clearFilterButton.click();
      await skillsPage.ensureRowExists(MANUAL_SKILL_NAME);
    });

    test('[SKL-CRUD-05] Skill can be disabled and re-enabled using the row toggle', async ({
      navigationBar,
      skillsPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      const row = await skillsPage.getRowLocatorByName(MANUAL_SKILL_NAME);

      await test.step('skill is enabled by default', async () => {
        await skillsPage.expectSkillEnabledState(row, true);
      });

      await test.step('disabling the skill', async () => {
        await skillsPage.disableSkill(row);
        await skillsPage.expectSkillEnabledState(row, false);
      });

      await test.step('re-enabling the skill', async () => {
        await skillsPage.enableSkill(row);
        await skillsPage.expectSkillEnabledState(row, true);
      });
    });

    test('[SKL-CRUD-06] Deleting the last skill restores the empty state', async ({ navigationBar, skillsPage }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.deleteSkillByName(MANUAL_SKILL_NAME);
      await skillsPage.ensureRowDoesNotExist(MANUAL_SKILL_NAME);
      await expect(skillsPage.noSkillsMessage).toBeVisible();
    });
  });

test.describe
  .serial('Skills page - file import', { tag: '@smoke' }, () => {
    test.skip(SKILL_FILES.length === 0, 'No SKILL.md files found — nothing to import');

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[SKL-IMPORT-01] Importing each SKILL.md file adds a new entry to the skills table', async ({
      electronApp,
      navigationBar,
      skillsPage,
    }) => {
      for (const filePath of SKILL_FILES) {
        await navigationBar.navigateToSkillsPage();
        const countBefore = await skillsPage.countRowsFromTable().catch(() => 0);

        await skillsPage.importSkill(filePath, electronApp);

        await skillsPage.waitForLoad();
        await expect(skillsPage.table).toBeVisible();
        await expect.poll(async () => await skillsPage.countRowsFromTable()).toBe(countBefore + 1);
      }
    });

    test(`[SKL-IMPORT-02] Table shows ${SKILL_FILES.length} imported skills`, async ({ navigationBar, skillsPage }) => {
      await navigationBar.navigateToSkillsPage();
      await expect.poll(async () => await skillsPage.countRowsFromTable()).toBe(SKILL_FILES.length);
    });

    test('[SKL-IMPORT-03] Deleting all imported skills restores the empty state', async ({
      navigationBar,
      skillsPage,
    }) => {
      await navigationBar.navigateToSkillsPage();
      for (const name of await skillsPage.getSkillNames()) {
        await skillsPage.deleteSkillByName(name);
      }
      await expect(skillsPage.noSkillsMessage).toBeVisible();
    });
  });

test.describe
  .serial('Skills page - skill details', { tag: '@smoke' }, () => {
    test.skip(!TEST_SKILL, 'No SKILL.md files found — nothing to import');

    test.beforeAll(async ({ page, electronApp, navigationBar, skillsPage }) => {
      await waitForNavigationReady(page);
      await navigationBar.navigateToSkillsPage();
      await skillsPage.importSkill(TEST_SKILL, electronApp);
      await skillsPage.waitForLoad();
      await skillsPage.ensureRowExists(TEST_SKILL_NAME);
    });

    test.afterAll(async ({ navigationBar, skillsPage }) => {
      await navigationBar.navigateToSkillsPage();
      await skillsPage.waitForLoad();
      if (await skillsPage.checkIfSkillsPageIsEmpty()) return;
      await skillsPage.deleteSkillByName(TEST_SKILL_NAME);
    });

    test.beforeEach(async ({ page, navigationBar }) => {
      await waitForNavigationReady(page);
      await navigationBar.navigateToSkillsPage();
    });

    test('[SKL-DETAIL-01] Summary tab shows skill information', async ({ skillsPage }) => {
      const detailsPage = await skillsPage.openSkillDetails(TEST_SKILL_NAME);
      await detailsPage.waitForLoad();

      await test.step('about section displays skill description', async () => {
        await expect(detailsPage.tabContentRegion).not.toBeEmpty();
      });

      for (const field of ['Name', 'Type', 'Status', 'Path']) {
        await test.step(`general information field "${field}" is visible and populated`, async () => {
          await expect(detailsPage.getDetailRowValue(field)).toBeVisible();
          await expect(detailsPage.getDetailRowValue(field)).not.toHaveText('');
        });
      }

      for (const field of ['Instructions Size', 'Bundled Resources']) {
        await test.step(`metadata field "${field}" is visible and populated`, async () => {
          await expect(detailsPage.getDetailRowValue(field)).toBeVisible();
          await expect(detailsPage.getDetailRowValue(field)).not.toHaveText('');
        });
      }
    });

    test('[SKL-DETAIL-02] Instructions tab displays SKILL.md content', async ({ skillsPage }) => {
      const detailsPage = await skillsPage.openSkillDetails(TEST_SKILL_NAME);
      await detailsPage.waitForLoad();
      await detailsPage.switchToInstructionsTab();

      await expect(detailsPage.instructionsFilename).toBeVisible();
      await expect(detailsPage.instructionsContent).toBeVisible();
      await expect(detailsPage.instructionsContent).not.toBeEmpty();
    });

    test('[SKL-DETAIL-03] Resources tab lists bundled resource files', async ({ skillsPage }) => {
      const detailsPage = await skillsPage.openSkillDetails(TEST_SKILL_NAME);
      await detailsPage.waitForLoad();
      await detailsPage.switchToResourcesTab();

      await expect(detailsPage.resourcesHeader).toContainText(/Bundled Resources \(\d+\)/);
    });

    test('[SKL-DETAIL-04] Detail page reflects skill status changed from list', async ({ skillsPage }) => {
      await test.step('disabled status is reflected in detail page', async () => {
        const row = await skillsPage.getRowLocatorByName(TEST_SKILL_NAME);
        await skillsPage.disableSkill(row);
        await skillsPage.expectSkillEnabledState(row, false);

        const detailsPage = await skillsPage.openSkillDetails(TEST_SKILL_NAME);
        await detailsPage.waitForLoad();
        await detailsPage.expectStatusEnabled(false);
        await detailsPage.closeDetailsPage();
      });

      await test.step('enabled status is reflected in detail page', async () => {
        const row = await skillsPage.getRowLocatorByName(TEST_SKILL_NAME);
        await skillsPage.enableSkill(row);
        await skillsPage.expectSkillEnabledState(row, true);

        const detailsPage = await skillsPage.openSkillDetails(TEST_SKILL_NAME);
        await detailsPage.waitForLoad();
        await detailsPage.expectStatusEnabled(true);
      });
    });
  });
