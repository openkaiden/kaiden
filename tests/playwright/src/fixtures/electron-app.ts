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
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, type ElectronApplication, type Page, test as base } from '@playwright/test';

import { TIMEOUTS } from '/@/model/core/types';
import { NavigationBar } from '/@/model/navigation/navigation';
import { AgentWorkspacesPage } from '/@/model/pages/agent-workspaces-page';
import { ChatPage } from '/@/model/pages/chat-page';
import { ExtensionsPage } from '/@/model/pages/extensions-page';
import { KnowledgePage } from '/@/model/pages/knowledge-page';
import { SettingsMcpPage } from '/@/model/pages/settings-mcp-tab-page';
import { SettingsPage } from '/@/model/pages/settings-page';
import { SkillsPage } from '/@/model/pages/skills-page';
import { type AppReadyOptions, waitForAppReady } from '/@/utils/app-ready';
import { savePendingVideos, saveTestArtifacts } from '/@/utils/test-artifacts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../../..');
const DEVTOOLS_URL_PREFIX = 'devtools://';
const isProductionMode = !!process.env.KAIDEN_BINARY;
const CDP_POLL_INTERVAL_MS = 250;
/** When true, forward Electron main stderr and renderer console between Playwright test titles. */
const verboseElectronLogs = process.env.KAIDEN_E2E_VERBOSE_LOGS === 'true';

export interface ElectronFixtures {
  electronApp: ElectronApplication;
  page: Page;
  navigationBar: NavigationBar;
  settingsPage: SettingsPage;
  knowledgePage: KnowledgePage;
  mcpPage: SettingsMcpPage;
  skillsPage: SkillsPage;
  extensionsPage: ExtensionsPage;
  chatPage: ChatPage;
  agentWorkspacesPage: AgentWorkspacesPage;
}

export interface WorkerElectronFixtures {
  workerElectronApp: ElectronApplication;
  workerPage: Page;
}

export type { AppReadyOptions } from '/@/utils/app-ready';

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
      await savePendingVideos();
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

  knowledgePage: async ({ page }, use): Promise<void> => {
    const knowledgePage = new KnowledgePage(page);
    await use(knowledgePage);
  },

  mcpPage: async ({ page }, use): Promise<void> => {
    const mcpPage = new SettingsMcpPage(page);
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
      await savePendingVideos();
    },
    { scope: 'worker' },
  ],

  workerPage: [
    async ({ workerElectronApp }, use): Promise<void> => {
      const page = await getFirstPage(workerElectronApp);
      await use(page);
    },
    { scope: 'worker' },
  ],

  electronApp: async ({ workerElectronApp }, use): Promise<void> => {
    await use(workerElectronApp);
  },

  page: async ({ workerPage }, use, testInfo): Promise<void> => {
    await use(workerPage);
    await saveTestArtifacts(workerPage, testInfo);
  },
});

function isDevToolsWindow(url: string): boolean {
  return url.startsWith(DEVTOOLS_URL_PREFIX);
}

export async function getDevModeWindow(electronApp: ElectronApplication): Promise<Page> {
  return waitForCdpReadyPage(electronApp);
}

async function isPageCdpReady(page: Page): Promise<boolean> {
  if (page.isClosed()) {
    return false;
  }
  try {
    return await page.evaluate(() => {
      return (
        document.readyState === 'interactive' ||
        document.readyState === 'complete' ||
        document.querySelector('main') !== null
      );
    });
  } catch {
    return false;
  }
}

function getAppWindows(electronApp: ElectronApplication): Page[] {
  return electronApp.windows().filter(window => !window.isClosed() && !isDevToolsWindow(window.url()));
}

/**
 * Playwright can list a window in `windows()` before CDP is attached. On Windows CI
 * `page.url()` may stay empty while the renderer is alive. Avoid firstWindow() — it can
 * block until the debugger disconnects (Playwright #29386) even after dom-ready fires.
 * Poll windows() and waitForEvent('window') until evaluate() reaches the document.
 */
async function waitForCdpReadyPage(electronApp: ElectronApplication, timeout = TIMEOUTS.DEFAULT): Promise<Page> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    for (const candidate of getAppWindows(electronApp)) {
      if (await isPageCdpReady(candidate)) {
        return candidate;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    try {
      const page = await electronApp.waitForEvent('window', {
        timeout: Math.min(2_000, remaining),
        predicate: candidate => !candidate.isClosed() && !isDevToolsWindow(candidate.url()),
      });
      if (await isPageCdpReady(page)) {
        return page;
      }
    } catch {
      // No new window this interval — keep polling existing windows.
    }

    await new Promise(resolve => setTimeout(resolve, CDP_POLL_INTERVAL_MS));
  }

  throw new Error(`No CDP-ready dev mode page within ${timeout}ms`);
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
  delete electronEnv.ELECTRON_ENABLE_INSPECT;
  delete electronEnv.ELECTRON_ENABLE_STACK_DUMPING;

  return electronEnv;
}

/**
 * On macOS with HOME overridden to a temp dir, the Podman container extension
 * builds the socket path as `$HOME/.local/share/containers/podman/machine/podman.sock`.
 * Two things must hold for this to work:
 *
 *  1. The socket file must exist at that path (symlink to the real one).
 *  2. The full path must be ≤104 bytes (Unix domain socket limit on macOS).
 *
 * Additionally, `podman machine ls` must find its machine config, which lives
 * under `$HOME/.config/containers`.
 *
 * We satisfy both by:
 *  - Using `/tmp` (short prefix) instead of `tmpdir()` on macOS so the total
 *    socket path stays ~79 bytes after realpathSync.
 *  - Symlinking `.local/share/containers` and `.config/containers` from the
 *    real HOME into the short temp dir.
 *  - Symlinking `Library/Keychains` so the kdn CLI can store secrets via the
 *    macOS Security framework (which locates keychains under ~/Library/).
 */
function createMacOSTempDir(): string {
  return mkdtempSync(join('/tmp', 'kdn-test-'));
}

function bridgePaths(testHome: string, relPaths: string[]): void {
  const realHome = homedir();
  for (const relPath of relPaths) {
    const src = join(realHome, relPath);
    if (!existsSync(src)) continue;
    const dest = join(testHome, relPath);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      symlinkSync(src, dest, 'dir');
    } catch {
      // Symlink already present — safe to skip
    }
  }
}

const MAC_BRIDGE_PATHS = [
  join('.local', 'share', 'containers'),
  join('.config', 'containers'),
  join('Library', 'Keychains'),
];

const LINUX_BRIDGE_PATHS = [
  join('.local', 'share', 'containers'),
  join('.config', 'containers'),
  join('.local', 'share', 'keyrings'),
];

function setupTestConfigDir(electronEnv: Record<string, string>): void {
  // On macOS, use /tmp (short prefix) so the Podman socket path derived from HOME
  // stays under the 104-byte Unix domain socket limit. The default tmpdir() on macOS
  // returns /var/folders/<hash>/T/ which is ~56 chars and causes the socket path to
  // exceed the limit (~130 bytes vs 104 max).
  const testDataDir =
    process.platform === 'darwin' ? createMacOSTempDir() : mkdtempSync(join(tmpdir(), 'kaiden-test-'));
  // realpathSync resolves macOS /var → /private/var symlinks so all paths match what the Goose CLI returns.
  const realTestDataDir = realpathSync(testDataDir);
  electronEnv.KAIDEN_HOME_DIR = realTestDataDir;
  // On Windows, do NOT override HOME or USERPROFILE — Chromium uses HOME for internal cache
  // path resolution, and setting it to an empty temp dir prevents the renderer from initializing
  // (loadURL hangs forever). KAIDEN_HOME_DIR is sufficient for app-level config isolation.
  if (process.platform !== 'win32') {
    electronEnv.HOME = realTestDataDir;
    electronEnv.USERPROFILE = realTestDataDir;
  }
  // On Linux, LinuxXDGDirectories prefers XDG_CONFIG_HOME/XDG_DATA_HOME over homedir() — point them at the temp dir.
  if (process.platform === 'linux') {
    electronEnv.XDG_CONFIG_HOME = join(realTestDataDir, '.config');
    electronEnv.XDG_DATA_HOME = join(realTestDataDir, '.local', 'share');
    bridgePaths(realTestDataDir, LINUX_BRIDGE_PATHS);
  }
  if (process.platform === 'darwin') {
    bridgePaths(realTestDataDir, MAC_BRIDGE_PATHS);
  }

  const configDir = join(realTestDataDir, 'configuration');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(realTestDataDir, 'rag'), { recursive: true });

  writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ 'preferences.OpenDevTools': 'none' }));
}

function buildLaunchArgs(): string[] {
  const args: string[] = [];
  if (process.platform === 'linux') {
    args.push('--no-sandbox');
  }
  if (process.platform === 'darwin') {
    args.push('--use-mock-keychain');
  }
  if (process.env.CI) {
    args.push('--disable-gpu', '--disable-gpu-compositing', '--force-device-scale-factor=1');
    if (process.platform === 'win32') {
      args.push('--use-gl=swiftshader');
    }
  }

  return args;
}

function createLaunchConfig(): Parameters<typeof electron.launch>[0] {
  const electronEnv = prepareElectronEnv();
  const recordVideo = { dir: join(tmpdir(), 'kaiden-test-videos') };

  setupTestConfigDir(electronEnv);
  const args = buildLaunchArgs();

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
    cwd: repoRoot,
    recordVideo,
  };
}

export async function launchElectronApp(): Promise<ElectronApplication> {
  return electron.launch(createLaunchConfig());
}

async function waitForUsablePage(electronApp: ElectronApplication): Promise<Page> {
  let page: Page;
  if (isProductionMode) {
    page = await electronApp.firstWindow({ timeout: TIMEOUTS.DEFAULT });
  } else {
    page = await getDevModeWindow(electronApp);
  }

  if (page.isClosed()) {
    page = await electronApp.waitForEvent('window', {
      timeout: TIMEOUTS.NON_DEVTOOLS_WINDOW,
      predicate: candidate => !candidate.isClosed() && !isDevToolsWindow(candidate.url()),
    });
  }

  return page;
}

export async function getFirstPage(
  electronApp: ElectronApplication,
  appReadyOptions: AppReadyOptions = {},
): Promise<Page> {
  const deadline = Date.now() + TIMEOUTS.DEFAULT;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const page = await waitForUsablePage(electronApp);
      const remaining = Math.max(1_000, deadline - Date.now());

      if (page.isClosed()) {
        throw new Error(
          `Selected page is already closed before waitForAppReady. ${getElectronDiagnosticsSummary(electronApp)}`,
        );
      }

      let pageClosedDuringReady = false;
      const onPageClose = (): void => {
        pageClosedDuringReady = true;
      };
      page.on('close', onPageClose);
      try {
        await waitForAppReady(page, remaining, appReadyOptions);
      } finally {
        page.off('close', onPageClose);
      }
      if (pageClosedDuringReady || page.isClosed()) {
        throw new Error('Target page closed during waitForAppReady');
      }

      if (verboseElectronLogs) {
        page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
        electronApp.process().stderr?.on('data', data => {
          console.log(`STDERR: ${data}`);
        });
      }

      return page;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const pageLost =
        message.includes('closed') || message.includes('Target page') || message.includes('No CDP-ready');
      if (pageLost && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, CDP_POLL_INTERVAL_MS));
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function getElectronDiagnosticsSummary(electronApp: ElectronApplication): string {
  const processState = electronApp.process();
  const stderrTail = processState.stderr ? 'stderr attached' : 'stderr unavailable';
  return `electronDiagnostics={processClosed=${processState.killed},exitCode=${processState.exitCode ?? 'null'},exitSignal=${processState.signalCode ?? 'null'},${stderrTail}}`;
}

export async function closeAllWindows(electronApp: ElectronApplication): Promise<void> {
  const windows = electronApp.windows();
  await Promise.allSettled(windows.map(window => window.close()));
}

export { expect } from '@playwright/test';
