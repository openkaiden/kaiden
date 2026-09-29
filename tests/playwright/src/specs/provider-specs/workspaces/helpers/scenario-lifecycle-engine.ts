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
 *
 * Shared step-based lifecycle engine used by both workspace and session
 * E2E helpers. See .agents/skills/playwright-testing/scenario-lifecycle-e2e.md
 ***********************************************************************/

import type { TestType } from '@playwright/test';

import type { test as providerTest } from '/@/fixtures/provider-fixtures';
import { PROVIDERS, type ResourceId } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

type AllFixtures<T> = T extends TestType<infer Test, infer Worker> ? Test & Worker : never;
type ProviderFixtures = AllFixtures<typeof providerTest>;

export type EngineWorkerFixtures = Pick<ProviderFixtures, 'workerNavigationBar'>;
export type EngineTestFixtures = Pick<
  ProviderFixtures,
  'navigationBar' | 'agentWorkspacesPage' | 'agentSessionsPage' | 'agentSessionDetailPage' | 'electronApp'
>;

export interface ScenarioStep<TCtx> {
  id: string;
  title: string;
  run: (fixtures: EngineTestFixtures, ctx: TCtx) => Promise<void>;
}

export interface ScenarioLifecycleConfig<TCtx> {
  setup: (fixtures: EngineWorkerFixtures) => Promise<TCtx>;
  teardown?: (ctx: TCtx, fixtures: EngineWorkerFixtures) => Promise<void>;
  steps: ScenarioStep<TCtx>[];
}

export function registerScenarioLifecycleTests<TCtx>(
  test: typeof providerTest,
  config: ScenarioLifecycleConfig<TCtx>,
): void {
  let ctx: TCtx;

  test.beforeAll(async ({ workerNavigationBar }) => {
    ctx = await config.setup({ workerNavigationBar });
  });

  if (config.teardown) {
    const teardown = config.teardown;
    test.afterAll(async ({ workerNavigationBar }) => {
      await teardown(ctx, { workerNavigationBar });
    });
  }

  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  for (const step of config.steps) {
    test(`[${step.id}] ${step.title}`, async ({
      navigationBar,
      agentWorkspacesPage,
      agentSessionsPage,
      agentSessionDetailPage,
      electronApp,
    }) =>
      step.run({ navigationBar, agentWorkspacesPage, agentSessionsPage, agentSessionDetailPage, electronApp }, ctx));
  }
}

export function skipUnlessPlatformSupported(
  test: typeof providerTest,
  podmanSkipMessage: string,
  requiredResource?: ResourceId,
): void {
  const podmanAvailable = !!process.env.PODMAN_ENABLED;
  test.skip(process.platform !== 'linux' && !podmanAvailable, podmanSkipMessage);

  if (requiredResource) {
    const envVar = PROVIDERS[requiredResource].envVarName;
    test.skip(!process.env[envVar], `${envVar} not set`);
  }
}

export async function createRequiredResource(
  fixtures: EngineWorkerFixtures,
  requiredResource: ResourceId,
): Promise<void> {
  const provider = PROVIDERS[requiredResource];
  if ('autoDetected' in provider && provider.autoDetected) {
    return;
  }
  const settingsPage = await fixtures.workerNavigationBar.navigateToSettingsPage();
  await settingsPage.createResource(requiredResource, process.env[provider.envVarName]!);
  await fixtures.workerNavigationBar.navigateToWorkspacesPage();
}

export async function deleteRequiredResource(
  fixtures: EngineWorkerFixtures,
  requiredResource: ResourceId,
): Promise<void> {
  const provider = PROVIDERS[requiredResource];
  if ('autoDetected' in provider && provider.autoDetected) {
    return;
  }
  try {
    const settingsPage = await fixtures.workerNavigationBar.navigateToSettingsPage();
    await settingsPage.deleteResource(requiredResource);
  } catch (error) {
    console.error(`Failed to delete ${requiredResource} resource:`, error);
  }
}
