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

import { expect, workerTest as test } from '/@/fixtures/electron-app';
import { INFERENCE_MODELS, TIMEOUTS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

// The catalog splits queries on whitespace, '-' and '_' (renderer search-util.ts); cover each separator.
const SEPARATORS = [' ', '-', '_'];

function nameParts(modelName: string): string[] {
  return modelName.split(/[^a-z0-9.]+/i).filter(Boolean);
}

// Rows are also searchable by provider id/name, so 'ollama' is part of every row's searchable text.
function canBeToldApart(target: string, other: string): boolean {
  const otherSearchText = `${other} ollama`.toLowerCase();
  return nameParts(target).some(part => !otherSearchText.includes(part.toLowerCase()));
}

test.describe('Models catalog search', { tag: '@smoke' }, () => {
  test.skip(!process.env.OLLAMA_ENABLED, 'Requires Ollama (OLLAMA_ENABLED)');
  test.skip(INFERENCE_MODELS.length < 2, 'Requires two distinct models in INFERENCE_MODEL and INFERENCE_SECOND_MODEL');

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.ensureExtensionsRunning();
    await navigationBar.navigateToSettingsPage();
  });

  test('[MODELS-SEARCH-01] token-based search filters Ollama model rows', async ({ settingsPage }) => {
    const pairs = [INFERENCE_MODELS, INFERENCE_MODELS.toReversed()];
    for (const [target, other] of pairs) {
      expect(canBeToldApart(target, other), `'${target}' needs a name part that '${other}' lacks`).toBe(true);
    }

    const modelsPage = await settingsPage.openModels();
    await modelsPage.selectCategory('Local');
    for (const model of INFERENCE_MODELS) {
      await expect(modelsPage.getModelRow(model)).toBeVisible({ timeout: TIMEOUTS.STANDARD });
    }

    for (const [target, other] of pairs) {
      // Reversed parts, e.g. 'granite3.1-dense:2b' -> '2b dense granite3.1': every token must match on its own,
      // in any order, so this fails for plain substring search.
      const parts = nameParts(target).toReversed();

      for (const separator of SEPARATORS) {
        const query = parts.join(separator);
        await test.step(`'${query}' matches ${target} only`, async () => {
          await modelsPage.search(query);
          await expect(modelsPage.getModelRow(target)).toBeVisible();
          await expect(modelsPage.getModelRow(other)).toBeHidden();
        });
      }

      const noMatchQuery = `${parts.join(' ')} nomatch-e2e`;
      await test.step(`'${noMatchQuery}' matches nothing`, async () => {
        await modelsPage.search(noMatchQuery);
        await expect(modelsPage.filteredEmptyMessage).toBeVisible();
        await expect(modelsPage.getModelRow(target)).toBeHidden();
        await expect(modelsPage.getModelRow(other)).toBeHidden();
      });
    }

    await test.step('clearing the search restores all rows', async () => {
      await modelsPage.clearSearch();
      for (const model of INFERENCE_MODELS) {
        await expect(modelsPage.getModelRow(model)).toBeVisible();
      }
    });
  });
});
