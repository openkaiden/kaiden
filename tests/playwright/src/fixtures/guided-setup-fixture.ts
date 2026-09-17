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

import { type ElectronApplication, expect, type Page, test } from '@playwright/test';

import { getFirstPage, killDetachedGateway, launchElectronApp } from '/@/fixtures/electron-app';

export interface GuidedSetupSession {
  electronApp: ElectronApplication;
  page: Page;
}

/**
 * One fresh app profile per describe group (beforeAll/afterAll),
 * not per test. Keeps welcome/onboarding state across serial tests in the same group.
 */
export async function launchGuidedSetupSession(): Promise<GuidedSetupSession> {
  const electronApp = await launchElectronApp();
  const page = await getFirstPage(electronApp, { dismissWelcome: false });
  return { electronApp, page };
}

export async function closeGuidedSetupSession(electronApp: ElectronApplication): Promise<void> {
  await killDetachedGateway(electronApp);
  await electronApp.close().catch(() => {});
}

/** Binds a fresh guided-setup Electron session to the enclosing describe block via beforeAll/afterAll. */
export function bindGuidedSetupSession(): Partial<GuidedSetupSession> {
  const session: Partial<GuidedSetupSession> = {};

  test.beforeAll(async () => {
    ({ electronApp: session.electronApp, page: session.page } = await launchGuidedSetupSession());
  });

  test.afterAll(async () => {
    if (session.electronApp) {
      await closeGuidedSetupSession(session.electronApp);
    }
  });

  return session;
}

export { expect, test };
