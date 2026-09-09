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
import { expect } from '@playwright/test';

import { MCP_SERVERS, type MCPServerId, PROVIDERS, type ResourceId, TIMEOUTS } from '/@/model/core/types';
import { NavigationBar } from '/@/model/navigation/navigation';

import { type ElectronFixtures, type WorkerElectronFixtures, workerTest as base } from './electron-app';

interface WorkerFixtures extends WorkerElectronFixtures {
  workerNavigationBar: NavigationBar;
  resource: ResourceId;
  resourceSetup: void;
  mcpServers: MCPServerId[];
  mcpSetup: void;
  milvusConnectionName: string;
  milvusSetup: string;
  doclingConnectionName: string;
  doclingSetup: string;
}

export const test = base.extend<ElectronFixtures, WorkerFixtures>({
  resource: [
    'gemini' as ResourceId,
    {
      scope: 'worker',
      option: true,
    },
  ],

  mcpServers: [
    ['github'] as MCPServerId[],
    {
      scope: 'worker',
      option: true,
    },
  ],

  workerNavigationBar: [
    async ({ workerPage }, use): Promise<void> => {
      const navigationBar = new NavigationBar(workerPage);
      await use(navigationBar);
    },
    { scope: 'worker' },
  ],

  resourceSetup: [
    async ({ workerNavigationBar, resource }, use): Promise<void> => {
      const provider = PROVIDERS[resource];

      // Auto-detected providers (like Ollama) don't need UI-based resource creation
      if ('autoDetected' in provider && provider.autoDetected) {
        await use();
        return;
      }

      // RAG/chunk providers (like Milvus, Docling) are managed by dedicated setup fixtures
      if ('connectionType' in provider && (provider.connectionType === 'rag' || provider.connectionType === 'chunk')) {
        await use();
        return;
      }

      const credentials = process.env[provider.envVarName];
      if (!credentials) {
        console.log(`${provider.envVarName} not set, skipping ${resource} resource setup`);
        await use();
        return;
      }

      await workerNavigationBar.ensureExtensionsRunning();

      try {
        const settingsPage = await workerNavigationBar.navigateToSettingsPage();
        await settingsPage.createResource(resource, credentials);
        await use();
      } finally {
        await safeCleanup(async () => {
          const settingsPage = await workerNavigationBar.navigateToSettingsPage();
          await settingsPage.deleteResource(resource);
        }, `Failed to delete ${resource} resource`);
      }
    },
    { scope: 'worker', auto: true },
  ],

  mcpSetup: [
    async ({ workerNavigationBar, mcpServers }, use): Promise<void> => {
      const configuredServers: Array<{ id: MCPServerId; serverName: string }> = [];

      try {
        const settingsPage = await workerNavigationBar.navigateToSettingsPage();
        const mcpPage = await settingsPage.openMcp();

        for (const id of mcpServers) {
          const server = MCP_SERVERS[id];
          const token = requireEnvVar(server.envVarName);

          try {
            configuredServers.push({ id, serverName: server.serverName });
            await mcpPage.createServer(server.serverName, token);
          } catch (error) {
            console.warn(`MCP setup skipped for ${id}:`, error);
            throw error;
          }
        }

        await use();
      } finally {
        if (configuredServers.length > 0) {
          const settingsPage = await workerNavigationBar.navigateToSettingsPage();
          const mcpPage = await settingsPage.openMcp();

          await Promise.allSettled(
            configuredServers.map(({ id, serverName }) =>
              safeCleanup(() => mcpPage.deleteServer(serverName), `Failed to delete ${id} MCP server`),
            ),
          );
        }
      }
    },
    { scope: 'worker', auto: false },
  ],

  milvusConnectionName: [
    '',
    {
      scope: 'worker',
      option: true,
    },
  ],

  milvusSetup: [
    async ({ workerNavigationBar, milvusConnectionName }, use): Promise<void> => {
      if (!milvusConnectionName) {
        await use('');
        return;
      }

      const settingsPage = await workerNavigationBar.navigateToSettingsPage();
      const resourcesPage = await settingsPage.openResources();

      const existingConnection = resourcesPage.getCreatedConnectionFor('milvus', 'rag');
      if ((await existingConnection.count()) > 0) {
        const existingName = (await existingConnection.getAttribute('aria-label')) ?? milvusConnectionName;
        console.log(`Milvus connection '${existingName}' already exists, reusing it.`);
        await use(existingName);
        return;
      }

      let created = false;
      try {
        const createPage = await resourcesPage.openCreateMilvusPage();
        await createPage.create(milvusConnectionName);
        created = true;
        await createPage.goBackToResources();
        await resourcesPage.waitForLoad();
        await expect(resourcesPage.getCreatedConnectionFor('milvus', 'rag')).toBeVisible({
          timeout: TIMEOUTS.DEFAULT,
        });
        await use(milvusConnectionName);
      } catch (error) {
        if (!created) {
          console.warn(
            `Milvus setup skipped: no container engine available. Start Podman or Docker to run Knowledge Database tests. (${error})`,
          );
          await use('');
          return;
        }
        throw error;
      } finally {
        if (created) {
          await safeCleanup(async () => {
            const sp = await workerNavigationBar.navigateToSettingsPage();
            await sp.deleteResource('milvus');
          }, `Failed to delete Milvus connection '${milvusConnectionName}'`);
        }
      }
    },
    { scope: 'worker', auto: false },
  ],

  doclingConnectionName: [
    '',
    {
      scope: 'worker',
      option: true,
    },
  ],

  doclingSetup: [
    async ({ workerNavigationBar, doclingConnectionName }, use): Promise<void> => {
      if (!doclingConnectionName) {
        await use('');
        return;
      }

      const settingsPage = await workerNavigationBar.navigateToSettingsPage();
      const resourcesPage = await settingsPage.openResources();

      const existingConnection = resourcesPage.getCreatedConnectionFor('docling', 'chunk');
      if ((await existingConnection.count()) > 0) {
        const existingName = (await existingConnection.getAttribute('aria-label')) ?? doclingConnectionName;
        console.log(`Docling connection '${existingName}' already exists, reusing it.`);
        await use(existingName);
        return;
      }

      let created = false;
      try {
        const createPage = await resourcesPage.openCreateDoclingPage();
        await createPage.create(doclingConnectionName);
        created = true;
        await createPage.goBackToResources();
        await resourcesPage.waitForLoad();
        await expect(resourcesPage.getCreatedConnectionFor('docling', 'chunk')).toBeVisible({
          timeout: TIMEOUTS.DEFAULT,
        });
        await use(doclingConnectionName);
      } catch (error) {
        if (!created) {
          console.warn(
            `Docling setup skipped: no container engine available. Start Podman or Docker to run Knowledge Database tests. (${error})`,
          );
          await use('');
          return;
        }
        throw error;
      } finally {
        if (created) {
          await safeCleanup(async () => {
            const sp = await workerNavigationBar.navigateToSettingsPage();
            await sp.deleteResource('docling');
          }, `Failed to delete Docling connection '${doclingConnectionName}'`);
        }
      }
    },
    { scope: 'worker', auto: false, timeout: TIMEOUTS.IMAGE_PULL },
  ],
});

function requireEnvVar(envVarName: string): string {
  const value = process.env[envVarName];
  if (!value) {
    throw new Error(`${envVarName} environment variable is not set`);
  }
  return value;
}

async function safeCleanup(operation: () => Promise<void>, errorMessage: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`${errorMessage}:`, error);
  }
}

export { expect } from '@playwright/test';
