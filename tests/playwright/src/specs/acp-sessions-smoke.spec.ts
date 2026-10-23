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
import { TIMEOUTS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

// Only nav discoverability + the pre-sandbox empty state are covered here — both are cheap
// (no real agent/model needed). Tests that create a real sandbox (agent session lifecycle)
// live under provider-specs/workspaces/agent-sessions-smoke.spec.ts instead: real sandbox
// orchestration is deliberately kept out of the default PR `@smoke` gate (see
// .agents/skills/playwright-testing/workspace-provider-e2e.md), same as workspace creation.
test.skip(
  !!process.env.GITHUB_ACTIONS && process.platform !== 'linux' && !process.env.PODMAN_ENABLED,
  'ACP sessions smoke requires an OpenShell gateway with the Podman driver, which is not available on macOS/Windows GitHub Actions runners',
);

test.describe('Agents page - initial state', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  test('[ACP-NAV-01] Agents nav is visible once OpenShell is available; empty state shown before any Ready sandbox', async ({
    navigationBar,
  }) => {
    await expect(navigationBar.agentsLink).toBeVisible({ timeout: TIMEOUTS.STANDARD });

    // navigateToAgentsPage() already waits for `heading` to be visible via waitForLoad().
    const agentSessionsPage = await navigationBar.navigateToAgentsPage();

    await expect(agentSessionsPage.noReadySandboxesMessage).toBeVisible();
    await expect(agentSessionsPage.createButton).toBeDisabled();
  });
});
