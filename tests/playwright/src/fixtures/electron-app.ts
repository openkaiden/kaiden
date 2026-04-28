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

/** biome-ignore-all lint/correctness/noEmptyPattern: Playwright fixture pattern requires empty object when no dependencies are needed */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page, test as base } from '@playwright/test';
import { TIMEOUTS } from 'src/model/core/types';
import { NavigationBar } from 'src/model/navigation/navigation';
import { AgentWorkspacesPage } from 'src/model/pages/agent-workspaces-page';
import { ChatPage } from 'src/model/pages/chat-page';
import { ExtensionsPage } from 'src/model/pages/extensions-page';
import { FlowsPage } from 'src/model/pages/flows-page';
import { KnowledgePage } from 'src/model/pages/knowledge-page';
import { McpPage } from 'src/model/pages/mcp-page';
import { SettingsPage } from 'src/model/pages/settings-page';
import { SkillsPage } from 'src/model/pages/skills-page';

import { waitForAppReady } from '../utils/app-ready';
import { saveTestArtifacts } from '../utils/test-artifacts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEVTOOLS_URL_PREFIX = 'devtools://';
const isProductionMode = !!process.env.KAIDEN_BINARY;

export interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
  navigationBar: NavigationBar;
  settingsPage: SettingsPage;
  flowsPage: FlowsPage;
  knowledgePage: KnowledgePage;
  mcpPage: McpPage;
  skillsPage: SkillsPage;
  extensionsPage: ExtensionsPage;
  chatPage: ChatPage;
  agentWorkspacesPage: AgentWorkspacesPage;
}

export interface WorkerElectronFixtures {
  workerElectronApp: ElectronApplication;
  workerPage: Page;
}

export const test = base.extend<ElectronFixtures>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use): Promise<void> => {
    let electronApp: ElectronApplication | undefined;

    try {
      electronApp = await launchElectronApp();
      await use(electronApp);
    } finally {
      if (electronApp) {
        try {
          await closeAllWindows(electronApp);
          await electronApp.close();
        } catch (error) {
          console.error('Error closing Electron app:', error);
          try {
            await electronApp.close();
          } catch {
            // Ignore errors during forced close
          }
        }
      }
    }
  },

  page: async ({ electronApp }, use, testInfo): Promise<void> => {
    const page = await getFirstPage(electronApp);
    const context = page.context();
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await context.tracing.startChunk();

    await use(page);

    try {
      await saveTestArtifacts(page, testInfo);
    } finally {
      await context.tracing.stop().catch(() => {});
    }
  },

  navigationBar: async ({ page }, use): Promise<void> => {
    const navigationBar = new NavigationBar(page);
    await use(navigationBar);
  },

  settingsPage: async ({ page }, use): Promise<void> => {
    const settingsPage = new SettingsPage(page);
    await use(settingsPage);
  },

  flowsPage: async ({ page }, use): Promise<void> => {
    const flowsPage = new FlowsPage(page);
    await use(flowsPage);
  },

  knowledgePage: async ({ page }, use): Promise<void> => {
    const knowledgePage = new KnowledgePage(page);
    await use(knowledgePage);
  },

  mcpPage: async ({ page }, use): Promise<void> => {
    const mcpPage = new McpPage(page);
    await use(mcpPage);
  },

  skillsPage: async ({ page }, use): Promise<void> => {
    const skillsPage = new SkillsPage(page);
    await use(skillsPage);
  },

  extensionsPage: async ({ page }, use): Promise<void> => {
    const extensionsPage = new ExtensionsPage(page);
    await use(extensionsPage);
  },

  chatPage: async ({ page }, use): Promise<void> => {
    const chatPage = new ChatPage(page);
    await use(chatPage);
  },

  agentWorkspacesPage: async ({ page }, use): Promise<void> => {
    const agentWorkspacesPage = new AgentWorkspacesPage(page);
    await use(agentWorkspacesPage);
  },
});

export const workerTest = test.extend<ElectronFixtures, WorkerElectronFixtures>({
  workerElectronApp: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use): Promise<void> => {
      const app = await launchElectronApp();
      await use(app);
      await app.close().catch(() => {});
    },
    { scope: 'worker' },
  ],

  workerPage: [
    async ({ workerElectronApp }, use): Promise<void> => {
      const page = await getFirstPage(workerElectronApp);
      await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
      await use(page);
      await page
        .context()
        .tracing.stop()
        .catch(() => {});
    },
    { scope: 'worker' },
  ],

  electronApp: async ({ workerElectronApp }, use): Promise<void> => {
    await use(workerElectronApp);
  },

  page: async ({ workerPage }, use, testInfo): Promise<void> => {
    await workerPage.context().tracing.startChunk();
    await use(workerPage);
    await saveTestArtifacts(workerPage, testInfo);
  },
});

function isDevToolsWindow(url: string): boolean {
  return url.startsWith(DEVTOOLS_URL_PREFIX);
}

function filterNonDevToolsWindows(windows: Page[]): Page[] {
  return windows.filter(w => !isDevToolsWindow(w.url()));
}

export async function getDevModeWindow(
  electronApp: ElectronApplication,
  retries = TIMEOUTS.MAX_RETRIES,
): Promise<Page> {
  let lastError: Error | unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const existingWindows = filterNonDevToolsWindows(electronApp.windows());
      if (existingWindows.length > 0) {
        return existingWindows[0];
      }

      return await electronApp.waitForEvent('window', {
        timeout: TIMEOUTS.NON_DEVTOOLS_WINDOW,
        predicate: page => !isDevToolsWindow(page.url()),
      });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const delay = TIMEOUTS.RETRY_DELAY * (attempt + 1);
        console.warn(
          `Failed to get dev window (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
          error,
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error('Failed to get dev window after retries, falling back to firstWindow:', lastError);
  const allWindows = electronApp.windows();
  if (allWindows.length > 0) {
    return allWindows[0];
  }

  throw new Error(`Failed to get any window from Electron app: ${lastError}`);
}

function prepareElectronEnv(): Record<string, string> {
  const electronEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      electronEnv[key] = value;
    }
  }
  // Remove Electron-specific variables that shouldn't be passed
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  return electronEnv;
}

function setupTestConfigDir(electronEnv: Record<string, string>): void {
  const testDataDir = mkdtempSync(join(tmpdir(), 'kaiden-test-'));
  // realpathSync resolves macOS /var → /private/var symlinks so all paths match what the Goose CLI returns.
  const realTestDataDir = realpathSync(testDataDir);
  electronEnv.KAIDEN_HOME_DIR = realTestDataDir;
  // Redirect home-dir env vars to the isolated temp dir so homedir() and Goose CLI use it instead of ~/.config/goose.
  electronEnv.HOME = realTestDataDir;
  // Do NOT override USERPROFILE on Windows — Electron uses it to derive AppData paths and
  // overriding it causes singleton-lock conflicts. Goose is not supported on Windows GHA runners anyway.
  if (process.platform !== 'win32') {
    electronEnv.USERPROFILE = realTestDataDir;
  }
  // On Linux, LinuxXDGDirectories prefers XDG_CONFIG_HOME/XDG_DATA_HOME over homedir() — point them at the temp dir.
  if (process.platform === 'linux') {
    electronEnv.XDG_CONFIG_HOME = join(realTestDataDir, '.config');
    electronEnv.XDG_DATA_HOME = join(realTestDataDir, '.local', 'share');
  }

  const configDir = join(realTestDataDir, 'configuration');
  mkdirSync(configDir, { recursive: true });

  writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ 'preferences.OpenDevTools': 'none' }));
}

function createLaunchConfig(): Parameters<typeof electron.launch>[0] {
  const electronEnv = prepareElectronEnv();
  const recordVideo = { dir: join(tmpdir(), 'kaiden-test-videos') };

  setupTestConfigDir(electronEnv);

  const args = ['--no-sandbox'];
  if (process.platform !== 'linux') {
    args.push('--use-mock-keychain');
  }

  if (isProductionMode) {
    return {
      executablePath: process.env.KAIDEN_BINARY,
      args,
      env: electronEnv,
      recordVideo,
    };
  }

  return {
    args: ['.', ...args],
    env: {
      ...electronEnv,
      ELECTRON_IS_DEV: '1',
    },
    cwd: resolve(__dirname, '../../../..'),
    recordVideo,
  };
}

export async function launchElectronApp(): Promise<ElectronApplication> {
  return electron.launch(createLaunchConfig());
}

export async function getFirstPage(electronApp: ElectronApplication): Promise<Page> {
  let page: Page;

  try {
    if (isProductionMode) {
      page = await electronApp.firstWindow({ timeout: TIMEOUTS.DEFAULT });
    } else {
      page = await getDevModeWindow(electronApp);
    }
  } catch (error) {
    const allWindows = electronApp.windows();
    if (allWindows.length > 0) {
      const nonDevToolsWindows = filterNonDevToolsWindows(allWindows);
      page = nonDevToolsWindows.length > 0 ? nonDevToolsWindows[0] : allWindows[0];
      console.warn('Using fallback window selection after error:', error);
    } else {
      throw new Error(`Failed to get first page: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await page.waitForLoadState('load', { timeout: TIMEOUTS.PAGE_LOAD });

  await waitForAppReady(page);

  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  electronApp.process().stderr?.on('data', data => {
    console.log(`STDERR: ${data}`);
  });

  return page;
}

export async function closeAllWindows(electronApp: ElectronApplication): Promise<void> {
  const windows = electronApp.windows();
  await Promise.allSettled(windows.map(window => window.close()));
}

export { expect } from '@playwright/test';
