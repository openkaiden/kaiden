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

import { expect, test } from '../fixtures/provider-fixtures';
import { waitForNavigationReady } from '../utils/app-ready';

test.describe('RAG page - empty state', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  test('[RAG-01] RAG page shows empty state when no environments exist', async ({ workerNavigationBar }) => {
    const ragPage = await workerNavigationBar.navigateToRagPage();
    await expect(ragPage.heading).toBeVisible();
    await expect(ragPage.noEnvironmentsMessage).toHaveText('No knowledge databases are currently configured.');
    await expect(ragPage.table).not.toBeVisible();
  });
});
