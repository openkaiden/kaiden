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
import { TIMEOUTS } from 'src/model/core/types';
import { waitForNavigationReady } from 'src/utils/app-ready';

import { expect, workerTest as test } from '../fixtures/electron-app';

test.describe
  .serial('App start', { tag: '@smoke' }, () => {
    test.beforeEach(async ({ page, navigationBar }) => {
      await waitForNavigationReady(page);
      await navigationBar.ensureChatWindowEnabled();
    });

    test('[APP-01] Navigation bar is visible and contains all expected navigation links', async ({ navigationBar }) => {
      await expect(navigationBar.navigationLocator).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
      const expectedLinksCount = 6; // Chat, MCP, Skills, Knowledges, Extensions, Settings

      const allLinks = navigationBar.getAllLinks();
      expect(allLinks).toHaveLength(expectedLinksCount);

      for (const link of allLinks) {
        await expect(link).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
      }
    });
  });
