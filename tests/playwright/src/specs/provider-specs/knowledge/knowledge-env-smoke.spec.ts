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

import type { ElectronApplication } from '@playwright/test';

import { expect, test } from '/@/fixtures/provider-fixtures';
import { TIMEOUTS } from '/@/model/core/types';
import type { NavigationBar } from '/@/model/navigation/navigation';
import type { KnowledgeDetailsPage } from '/@/model/pages/knowledge-details-page';
import { waitForNavigationReady } from '/@/utils/app-ready';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_FILE_PATH = resolve(__dirname, '../../../../resources/test-doc.pdf');
const TEST_MD_FILE_PATH = resolve(__dirname, '../../../../resources/test-doc.md');
const TEST_HTML_FILE_PATH = resolve(__dirname, '../../../../resources/test-doc.html');
const TEST_UNSUPPORTED_FILE_PATH = resolve(__dirname, '../../../../resources/test-doc.bin');

const VECTOR_STORE_NAME = 'e2e-milvus';
const EMBEDDING_MODEL_NAME = 'docling';

test.use({ milvusConnectionName: VECTOR_STORE_NAME, doclingConnectionName: EMBEDDING_MODEL_NAME });

async function openKnowledgeDetails(
  navigationBar: NavigationBar,
  environmentName: string,
): Promise<KnowledgeDetailsPage> {
  const knowledgePage = await navigationBar.navigateToKnowledgePage();
  const detailsPage = await knowledgePage.openEnvironmentDetails(environmentName);
  await detailsPage.waitForLoad();
  return detailsPage;
}

async function uploadAndAssertStatus(
  detailsPage: KnowledgeDetailsPage,
  electronApp: ElectronApplication,
  filePath: string,
  fileName: string,
  expectedStatus: 'pending' | 'indexed' | 'error',
  timeout: number = TIMEOUTS.IMAGE_PULL,
): Promise<void> {
  await detailsPage.uploadFile(filePath, electronApp);
  await expect(detailsPage.getUploadedFile(fileName)).toBeVisible();
  await expect(detailsPage.getUploadedFileRow(fileName)).toContainText(expectedStatus, { timeout });
}

test.describe('Knowledge Database provider tests', () => {
  test.skip(
    process.platform !== 'linux' && !process.env.PODMAN_ENABLED,
    'Knowledge Database tests require Podman (set PODMAN_ENABLED=true on non-Linux)',
  );

  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  test.describe
    .serial('Knowledge Database page - UI creation', { tag: ['@knowledge-provider', '@smoke'] }, () => {
      const ENVIRONMENT_NAME = 'test-knowledge-base';

      test('[KDB-02] Create knowledge database via UI and verify row appears', async ({
        milvusSetup: vectorStoreName,
        doclingSetup: _doclingSetup,
        workerNavigationBar,
      }) => {
        const knowledgePage = await workerNavigationBar.navigateToKnowledgePage();
        await knowledgePage.createEnvironment(ENVIRONMENT_NAME, vectorStoreName, EMBEDDING_MODEL_NAME);
      });

      test('[KDB-03] Details page shows all tabs and Sources tab has zero files', async ({ workerNavigationBar }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);

        await expect(detailsPage.heading).toContainText(ENVIRONMENT_NAME);
        await expect(detailsPage.summaryTabLink).toBeVisible();
        await expect(detailsPage.sourcesTabLink).toBeVisible();
        await expect(detailsPage.vectorStoreTabLink).toBeVisible();
        await expect(detailsPage.chunkerTabLink).toBeVisible();

        await detailsPage.switchToSourcesTab();
        await expect(detailsPage.uploadedFilesHeader).toContainText('0');

        await detailsPage.switchToChunkerTab();
        await expect(detailsPage.getInfoValue('Model')).toContainText(EMBEDDING_MODEL_NAME);
      });

      test('[KDB-04] Upload a file and verify it appears in Sources tab', async ({
        workerElectronApp,
        workerNavigationBar,
      }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);
        await detailsPage.switchToSourcesTab();

        await uploadAndAssertStatus(
          detailsPage,
          workerElectronApp,
          TEST_FILE_PATH,
          'test-doc.pdf',
          'pending',
          TIMEOUTS.STANDARD,
        );
        await expect(detailsPage.uploadedFilesHeader).toContainText('1');
      });

      test('[KDB-10] Uploaded PDF is indexed successfully', async ({ workerNavigationBar }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);
        await detailsPage.switchToSourcesTab();

        await expect(detailsPage.getUploadedFileRow('test-doc.pdf')).toContainText('indexed', {
          timeout: TIMEOUTS.IMAGE_PULL,
        });
      });

      test('[KDB-12] Uploaded non-PDF source (.md) is indexed successfully', async ({
        workerElectronApp,
        workerNavigationBar,
      }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);
        await detailsPage.switchToSourcesTab();

        await uploadAndAssertStatus(detailsPage, workerElectronApp, TEST_MD_FILE_PATH, 'test-doc.md', 'indexed');
      });

      test('[KDB-14] Uploaded HTML source is indexed successfully', async ({
        workerElectronApp,
        workerNavigationBar,
      }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);
        await detailsPage.switchToSourcesTab();

        await uploadAndAssertStatus(detailsPage, workerElectronApp, TEST_HTML_FILE_PATH, 'test-doc.html', 'indexed');
      });

      test('[KDB-13] Uploading a file with an unsupported extension fails with error status', async ({
        workerElectronApp,
        workerNavigationBar,
      }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);
        await detailsPage.switchToSourcesTab();

        // The file picker filters by extension, but the OS dialog is mocked in e2e, so an
        // unsupported extension can still reach the backend here — exercising the failure path.
        await uploadAndAssertStatus(
          detailsPage,
          workerElectronApp,
          TEST_UNSUPPORTED_FILE_PATH,
          'test-doc.bin',
          'error',
        );
      });

      test('[KDB-05] Delete knowledge database from details page', async ({ workerNavigationBar }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);

        const listPage = await detailsPage.deleteEnvironment();
        await listPage.waitForLoad();
        await listPage.ensureRowDoesNotExist(ENVIRONMENT_NAME);
      });
    });

  test.describe
    .serial('Knowledge Database Pipeline with Milvus', { tag: ['@knowledge-provider', '@smoke'] }, () => {
      const ENVIRONMENT_NAME = 'connected-knowledge-base';
      const EXPECTED_COLLECTION_NAME = 'connected_knowledge_base';
      const MCP_SERVER_NAME = `kaiden.milvus.mcp-server-milvus-${VECTOR_STORE_NAME}`;

      test('[KDB-06] Milvus connection is visible in Settings Resources', async ({
        milvusSetup: _milvusSetup,
        workerNavigationBar,
      }) => {
        const settingsPage = await workerNavigationBar.navigateToSettingsPage();
        const resourcesPage = await settingsPage.openResources();
        await resourcesPage.waitForLoad();

        const milvusRegion = resourcesPage.getProviderRegion('milvus');
        await expect(milvusRegion).toBeVisible();

        const connection = resourcesPage.getCreatedConnectionFor('milvus', 'rag');
        await expect(connection).toBeVisible();
      });

      test('[KDB-07] Create knowledge database via UI and verify it appears', async ({
        milvusSetup: vectorStoreName,
        doclingSetup: _doclingSetup,
        workerNavigationBar,
      }) => {
        const knowledgePage = await workerNavigationBar.navigateToKnowledgePage();
        await knowledgePage.createEnvironment(ENVIRONMENT_NAME, vectorStoreName, EMBEDDING_MODEL_NAME);
      });

      test('[KDB-08] Details page shows Milvus info in Summary and VectorStore tabs', async ({
        milvusSetup: vectorStoreName,
        workerNavigationBar,
      }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);

        await detailsPage.switchToSummaryTab();
        await expect(detailsPage.getInfoValue('Vector Store')).toContainText(vectorStoreName, {
          timeout: TIMEOUTS.DEFAULT,
        });

        await detailsPage.switchToVectorStoreTab();
        await expect(detailsPage.getInfoRow('Database Type')).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
        await expect(detailsPage.getInfoValue('Collection Name')).toHaveText(EXPECTED_COLLECTION_NAME, {
          timeout: TIMEOUTS.DEFAULT,
        });
      });

      test('[KDB-11] Milvus MCP server is auto-spawned and knowledge database status is RUNNING', async ({
        workerNavigationBar,
      }) => {
        const knowledgePage = await workerNavigationBar.navigateToKnowledgePage();
        await knowledgePage.waitForLoad();
        await expect
          .poll(async () => await knowledgePage.getEnvironmentStatus(ENVIRONMENT_NAME), {
            timeout: TIMEOUTS.DEFAULT,
          })
          .toBe('RUNNING');

        const settingsPage = await workerNavigationBar.navigateToSettingsPage();
        const mcpPage = await settingsPage.openMcp();
        const readyTab = await mcpPage.openReadyTab();
        await expect
          .poll(async () => await readyTab.isServerConnected(MCP_SERVER_NAME), { timeout: TIMEOUTS.DEFAULT })
          .toBeTruthy();
      });

      test('[KDB-09] Delete knowledge database from details page', async ({ workerNavigationBar }) => {
        const detailsPage = await openKnowledgeDetails(workerNavigationBar, ENVIRONMENT_NAME);

        const listPage = await detailsPage.deleteEnvironment();
        await listPage.waitForLoad();
        await listPage.ensureRowDoesNotExist(ENVIRONMENT_NAME);
      });
    });
});
