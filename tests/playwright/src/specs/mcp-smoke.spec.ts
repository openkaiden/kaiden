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
import { createServer, type RequestListener, type Server } from 'node:http';

import { expect, test } from '/@/fixtures/provider-fixtures';
import { MCP_SERVERS, TIMEOUTS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

const MCP_REGISTRY_EXAMPLE = 'MCP Registry example';
const SERVER_LIST_UPDATE_TIMEOUT = 60_000;

const MOCK_MCP_SERVER_NAME = 'io.test/mock-mcp-functional';

interface MockServer {
  server: Server;
  url: string;
}

async function startMockServer(handler: RequestListener): Promise<MockServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

async function stopMockServer(server: Server | undefined): Promise<void> {
  if (server) {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function createMockMcpServer(): RequestListener {
  return (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      let parsed: { jsonrpc: string; method: string; id?: number };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }

      if (parsed.method === 'initialize') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'mcp-session-id': 'test-session-1',
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'mock-mcp-functional', version: '1.0.0' },
            },
          }),
        );
      } else if (parsed.method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { tools: [] } }));
      } else if (parsed.method === 'notifications/initialized' || parsed.method === 'initialized') {
        res.writeHead(202).end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }
    });
  };
}

interface MockRegistryServer {
  server: Record<string, unknown>;
  _meta: Record<string, unknown>;
}

function createMockRegistryResponse(mcpServerUrl?: string): string {
  const servers: MockRegistryServer[] = [
    { server: { name: 'io.test/mock-server-alpha', description: 'Mock MCP server A', version: '1.0.0' }, _meta: {} },
    { server: { name: 'io.test/mock-server-beta', description: 'Mock MCP server B', version: '1.0.0' }, _meta: {} },
  ];

  if (mcpServerUrl) {
    servers.push({
      server: {
        name: MOCK_MCP_SERVER_NAME,
        description: 'Functional test MCP server',
        version: '1.0.0',
        remotes: [
          {
            type: 'streamable-http',
            url: mcpServerUrl,
            headers: [
              {
                name: 'Authorization',
                description: 'Bearer token',
                isRequired: true,
                isSecret: true,
                format: 'string',
              },
            ],
          },
        ],
      },
      _meta: {},
    });
  }

  return JSON.stringify({ servers, metadata: { count: servers.length } });
}

const MOCK_REGISTRY_RESPONSE = createMockRegistryResponse();

function jsonRegistryHandler(response: string): RequestListener {
  return (_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(response);
  };
}

test.describe('MCP Registry Management', { tag: '@smoke' }, () => {
  let server: Server;
  let mockRegistryUrl: string;

  test.beforeAll(async () => {
    const mock = await startMockServer(jsonRegistryHandler(MOCK_REGISTRY_RESPONSE));
    server = mock.server;
    mockRegistryUrl = mock.url;
  });

  test.afterAll(async () => {
    await stopMockServer(server);
  });

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    const settingsPage = await navigationBar.navigateToSettingsPage();
    await settingsPage.openMcp();
  });

  test('[MCP-01] Add and remove MCP registry: verify server list updates accordingly', async ({ mcpPage }) => {
    const editRegistriesTab = await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.ensureRowExists(MCP_REGISTRY_EXAMPLE);

    const installTab = await mcpPage.openInstallTab();
    await installTab.verifyInstallTabIsNotEmpty();
    const initialServerCount = await installTab.countRowsFromTable();

    await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.addNewRegistry(mockRegistryUrl);
    await editRegistriesTab.ensureRowExists(mockRegistryUrl);

    await mcpPage.openInstallTab();
    await installTab.verifyServerCountIncreased(initialServerCount, SERVER_LIST_UPDATE_TIMEOUT);

    await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.removeRegistry(mockRegistryUrl);
    await editRegistriesTab.ensureRowDoesNotExist(mockRegistryUrl);

    await mcpPage.openInstallTab();
    await installTab.verifyServerCountIsRestored(initialServerCount, SERVER_LIST_UPDATE_TIMEOUT);
  });
});

test.describe('MCP Server Management', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    const settingsPage = await navigationBar.navigateToSettingsPage();
    await settingsPage.openMcp();
  });

  test('[MCP-02] Add and remove MCP server: verify server list updates accordingly', async ({ mcpPage }) => {
    const envVar = MCP_SERVERS.github.envVarName;
    test.skip(!process.env[envVar], `${envVar} environment variable is not set`);

    const serverName = MCP_SERVERS.github.serverName;
    const token = process.env[envVar]!;

    await mcpPage.createServer(serverName, token);

    const readyTab = await mcpPage.openReadyTab();
    await expect
      .poll(async () => await readyTab.isServerConnected(serverName), { timeout: TIMEOUTS.SHORT })
      .toBeTruthy();

    await mcpPage.deleteServer(serverName);
  });
});

test.describe('MCP UI Interactions', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    const settingsPage = await navigationBar.navigateToSettingsPage();
    await settingsPage.openMcp();
  });

  test('[MCP-03] Search filters MCP servers in install tab', async ({ mcpPage }) => {
    const installTab = await mcpPage.openInstallTab();
    const initialServerCount = await installTab.countRowsFromTable();

    await mcpPage.searchServers('podman');
    await expect
      .poll(async () => await installTab.countRowsFromTable(), { timeout: TIMEOUTS.SHORT })
      .toBeLessThan(initialServerCount);
    await expect(installTab.findServer('ai.openkaiden.registry/podman')).toBeVisible();

    await mcpPage.clearSearch();
    await expect
      .poll(async () => await installTab.countRowsFromTable(), { timeout: TIMEOUTS.SHORT })
      .toBe(initialServerCount);
  });

  test('[MCP-04] Ready tab shows empty state when no servers connected', async ({ mcpPage }) => {
    const readyTab = await mcpPage.openReadyTab();
    await readyTab.verifyEmpty();
  });

  test('[MCP-05] Sort servers by name column in install tab', async ({ mcpPage }) => {
    const installTab = await mcpPage.openInstallTab();
    const firstRowBeforeSort = await installTab.getRowLocatorByIndex(1);
    const firstRowTextBeforeSort = await firstRowBeforeSort.textContent();

    await installTab.sortByColumn('Name');

    const firstRow = await installTab.getRowLocatorByIndex(1);
    await expect
      .poll(async () => await firstRow.textContent(), { timeout: TIMEOUTS.SHORT })
      .not.toBe(firstRowTextBeforeSort);
  });

  test('[MCP-06] Navigate to install form page and cancel', async ({ mcpPage }) => {
    const installTab = await mcpPage.openInstallTab();

    await installTab.clickInstallRemoteServer('ai.openkaiden.registry/podman');
    await expect(installTab.installFormHeading).toBeVisible({ timeout: TIMEOUTS.SHORT });

    await installTab.cancel();
    await expect(mcpPage.searchMcpServersField).toBeVisible({ timeout: TIMEOUTS.SHORT });
  });
});

test.describe('MCP Functional', { tag: '@smoke' }, () => {
  let mcpServerHandle: MockServer;
  let registryHandle: MockServer;

  test.beforeAll(async () => {
    mcpServerHandle = await startMockServer(createMockMcpServer());
    registryHandle = await startMockServer(jsonRegistryHandler(createMockRegistryResponse(mcpServerHandle.url)));
  });

  test.afterAll(async () => {
    await Promise.all([stopMockServer(mcpServerHandle?.server), stopMockServer(registryHandle?.server)]);
  });

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    const settingsPage = await navigationBar.navigateToSettingsPage();
    await settingsPage.openMcp();
  });

  test('[MCP-07] Install remote MCP server via mock, verify connection, then delete', async ({ mcpPage }) => {
    const editRegistriesTab = await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.addNewRegistry(registryHandle.url);
    await editRegistriesTab.ensureRowExists(registryHandle.url);

    try {
      const installTab = await mcpPage.openInstallTab();
      await expect
        .poll(async () => (await installTab.findServer(MOCK_MCP_SERVER_NAME).count()) > 0, {
          timeout: SERVER_LIST_UPDATE_TIMEOUT,
        })
        .toBeTruthy();

      await installTab.installRemoteServer(MOCK_MCP_SERVER_NAME, 'mock-token-value');

      const readyTab = await mcpPage.openReadyTab();
      await expect
        .poll(async () => await readyTab.isServerConnected(MOCK_MCP_SERVER_NAME), { timeout: TIMEOUTS.STANDARD })
        .toBeTruthy();

      await readyTab.deleteServer(MOCK_MCP_SERVER_NAME);
      await expect
        .poll(async () => await readyTab.isServerConnected(MOCK_MCP_SERVER_NAME), { timeout: TIMEOUTS.SHORT })
        .toBeFalsy();
    } finally {
      const editTab = await mcpPage.openEditRegistriesTab();
      await editTab.removeRegistry(registryHandle.url);
    }
  });

  test('[MCP-08] Registry returning errors does not break the install tab', async ({ mcpPage }) => {
    const errorHandle = await startMockServer((_, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    });

    try {
      const installTab = await mcpPage.openInstallTab();
      const initialServerCount = await installTab.countRowsFromTable();

      const editRegistriesTab = await mcpPage.openEditRegistriesTab();
      await editRegistriesTab.addNewRegistry(errorHandle.url);
      await editRegistriesTab.ensureRowExists(errorHandle.url);

      await mcpPage.openInstallTab();
      await installTab.waitForCatalogRefresh(SERVER_LIST_UPDATE_TIMEOUT);
      const countAfterBadRegistry = await installTab.countRowsFromTable();
      expect(countAfterBadRegistry).toBe(initialServerCount);

      await mcpPage.openEditRegistriesTab();
      await editRegistriesTab.removeRegistry(errorHandle.url);
    } finally {
      await stopMockServer(errorHandle.server);
    }
  });
});
