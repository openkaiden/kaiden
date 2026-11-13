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

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Configuration } from '@openkaiden/api';
import { Container, injectable, injectFromBase } from 'inversify';
import { beforeEach, expect, test, vi } from 'vitest';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { ConfigurationRegistry } from '/@/plugin/configuration-registry.js';
import { Directories } from '/@/plugin/directories.js';
import { LegacyDirectories } from '/@/plugin/directories-legacy.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { ApiServerSettings } from '/@api/api-server-settings.js';
import { type IConfigurationChangeEvent, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { GatewayInfo, GatewaySandboxes } from '/@api/openshell-gateway-info.js';

import { ApiServer } from './api-server.js';

vi.mock(import('/@/plugin/agent-workspace/agent-workspace-manager.js'));
vi.mock(import('/@/plugin/configuration-registry.js'));
vi.mock(import('/@/plugin/directories-legacy.js'));

@injectable()
@injectFromBase()
class TestApiServer extends ApiServer {
  static get portFilename(): string {
    return this.PORT_FILENAME;
  }

  get httpServer(): Server | undefined {
    return this.server;
  }
}

const gateway1: GatewayInfo = { name: 'gw1', endpoint: 'http://localhost:1', canStop: false, canStart: false };
const gateway2: GatewayInfo = { name: 'gw2', endpoint: 'http://localhost:2', canStop: false, canStart: false };

let configuration: Configuration;
let configurationChanged: Emitter<IConfigurationChangeEvent>;
let dataDir: string | undefined;
let apiServer: TestApiServer | undefined;

function newApiServer(directory: string): TestApiServer {
  const container = new Container();
  vi.mocked(LegacyDirectories.prototype.getDataDirectory).mockReturnValue(directory);
  container.bind(Directories).toConstantValue(Object.create(LegacyDirectories.prototype));
  container.bind(AgentWorkspaceManager).toConstantValue(Object.create(AgentWorkspaceManager.prototype));
  container.bind(IConfigurationRegistry).toConstantValue(
    Object.assign(Object.create(ConfigurationRegistry.prototype), {
      onDidChangeConfiguration: configurationChanged.event,
    }),
  );
  container.bind(TestApiServer).toSelf().inSingletonScope();
  return container.get(TestApiServer);
}

async function startServer(): Promise<{ port: number; token: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  apiServer = newApiServer(directory);
  await apiServer.init();
  const [port, token] = (await readFile(join(directory, TestApiServer.portFilename), 'utf-8')).split('\n');
  return { port: Number(port), token: token ?? '', directory };
}

function call(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sandboxes(gateway: GatewayInfo, ...names: string[]): GatewaySandboxes {
  return { gateway, sandboxes: names.map(name => ({ id: `id-${name}`, name, phase: 'Ready' })) };
}

beforeEach(async () => {
  await apiServer?.dispose();
  apiServer = undefined;
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
  vi.resetAllMocks();
  console.error = vi.fn();
  console.warn = vi.fn();
  console.debug = vi.fn();
  configuration = { get: vi.fn(), has: vi.fn(), update: vi.fn() };
  configurationChanged = new Emitter<IConfigurationChangeEvent>();
  vi.mocked(configuration.get).mockReturnValue(true);
  vi.mocked(ConfigurationRegistry.prototype.getConfiguration).mockReturnValue(configuration);
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockResolvedValue([sandboxes(gateway1, 'ws1')]);
});

test('does not listen when disabled', async () => {
  vi.mocked(configuration.get).mockReturnValue(false);
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  apiServer = newApiServer(directory);

  await apiServer.init();

  expect(ConfigurationRegistry.prototype.registerConfigurations).toHaveBeenCalled();
  expect(apiServer.httpServer).toBeUndefined();
  await expect(stat(join(directory, TestApiServer.portFilename))).rejects.toThrow('ENOENT');
});

function toggle(enabled: boolean): void {
  vi.mocked(configuration.get).mockReturnValue(enabled);
  configurationChanged.fire({
    key: `${ApiServerSettings.SectionName}.${ApiServerSettings.Enabled}`,
    value: enabled,
    scope: 'DEFAULT',
  });
}

test('stops when the setting is turned off and starts again when turned on', async () => {
  const { port, directory } = await startServer();
  const portFile = join(directory, TestApiServer.portFilename);

  toggle(false);
  await vi.waitFor(() => expect(apiServer?.httpServer).toBeUndefined());
  await expect(stat(portFile)).rejects.toThrow('ENOENT');
  await expect(call(port, 'GET', '/api/workspaces', {})).rejects.toThrow('ECONNREFUSED');

  toggle(true);
  await vi.waitFor(() => expect(apiServer?.httpServer?.listening).toBe(true));
  await vi.waitFor(() => stat(portFile));
  const [newPort, newToken] = (await readFile(portFile, 'utf-8')).split('\n');
  expect((await call(Number(newPort), 'GET', '/api/workspaces', { authorization: `Bearer ${newToken}` })).status).toBe(
    200,
  );
});

test('ignores changes of other settings', async () => {
  await startServer();
  vi.mocked(configuration.get).mockReturnValue(false);
  configurationChanged.fire({ key: 'other.setting', value: false, scope: 'DEFAULT' });

  await new Promise(resolve => setImmediate(resolve));
  expect(apiServer?.httpServer?.listening).toBe(true);
});

test('dispose stops listening to setting changes', async () => {
  vi.mocked(configuration.get).mockReturnValue(false);
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  apiServer = newApiServer(directory);
  await apiServer.init();
  await apiServer.dispose();

  toggle(true);

  await new Promise(resolve => setImmediate(resolve));
  expect(apiServer.httpServer).toBeUndefined();
  expect(ConfigurationRegistry.prototype.getConfiguration).toHaveBeenCalledTimes(1);
});

test('writes a port file with port and token', async () => {
  const { port, token } = await startServer();
  expect(port).toBeGreaterThan(0);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
});

// Windows ignores the mode: the file gets the ACL inherited from the user data directory
test.skipIf(process.platform === 'win32')('the port file is readable by its owner only', async () => {
  const { directory } = await startServer();
  expect((await stat(join(directory, TestApiServer.portFilename))).mode & 0o777).toBe(0o600);
});

test('answers unknown routes with a JSON 404', async () => {
  const { port, token } = await startServer();

  const res = await call(port, 'GET', '/api/unknown', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(404);
  expect(JSON.parse(res.body)).toEqual({ error: 'Not found' });
});

test('answers a malformed percent-encoding with a JSON 400 and logs the error', async () => {
  const { port, token } = await startServer();

  const res = await call(port, 'DELETE', '/api/workspaces/%E0', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(400);
  expect(JSON.parse(res.body)).toEqual({ error: 'Bad request' });
  expect(console.error).toHaveBeenCalledWith('API server: request failed', expect.any(URIError));
  expect(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).not.toHaveBeenCalled();
});

test('rejects requests without the token, with an Origin or with a foreign Host', async () => {
  const { port, token } = await startServer();
  const auth = { authorization: `Bearer ${token}` };
  expect((await call(port, 'GET', '/api/workspaces', {})).status).toBe(401);
  expect((await call(port, 'GET', '/api/workspaces', { authorization: 'Bearer wrong' })).status).toBe(401);
  expect((await call(port, 'GET', '/api/workspaces', { ...auth, origin: 'https://evil.test' })).status).toBe(401);
  expect((await call(port, 'GET', '/api/workspaces', { ...auth, host: `evil.test:${port}` })).status).toBe(401);
  expect(AgentWorkspaceManager.prototype.listOpenshellSandboxes).not.toHaveBeenCalled();
});

test('accepts localhost as Host', async () => {
  const { port, token } = await startServer();
  const res = await call(port, 'GET', '/api/workspaces', {
    authorization: `Bearer ${token}`,
    host: `localhost:${port}`,
  });
  expect(res.status).toBe(200);
});

test('lists the Kaiden workspaces of all gateways', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockResolvedValue([
    {
      gateway: gateway1,
      sandboxes: [
        {
          id: 'id1',
          name: 'ws1',
          phase: 'Ready',
          resource_version: 3,
          labels: { 'ai.openkaiden.kaiden.workspace': 'encoded' },
          sourcePath: '/home/user/project',
        },
      ],
    },
    sandboxes(gateway2, 'ws2'),
  ]);

  const res = await call(port, 'GET', '/api/workspaces', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(AgentWorkspaceManager.prototype.listOpenshellSandboxes).toHaveBeenCalledWith();
  expect(JSON.parse(res.body)).toEqual([
    {
      id: 'id1',
      name: 'ws1',
      phase: 'Ready',
      labels: { 'ai.openkaiden.kaiden.workspace': 'encoded' },
      resourceVersion: 3,
      sourcePath: '/home/user/project',
      gateway: 'gw1',
    },
    { id: 'id-ws2', name: 'ws2', phase: 'Ready', labels: {}, gateway: 'gw2' },
  ]);
});

test('a failing list returns 500 without leaking internal errors', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockRejectedValue(
    new Error('secret internal detail'),
  );

  const res = await call(port, 'GET', '/api/workspaces', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(500);
  expect(res.body).not.toContain('secret internal detail');
  expect(console.error).toHaveBeenCalledWith('API server error listing workspaces', expect.any(Error));
});

test('deletes a workspace on the requested gateway', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockResolvedValue([sandboxes(gateway2, 'ws1')]);

  const res = await call(port, 'DELETE', '/api/workspaces/ws1?gateway=gw2', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ deleted: true });
  expect(AgentWorkspaceManager.prototype.listOpenshellSandboxes).toHaveBeenCalledWith('gw2');
  expect(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).toHaveBeenCalledWith('ws1', 'gw2');
});

test('deletes a workspace on the only gateway that has it when no gateway is given', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockResolvedValue([sandboxes(gateway2, 'ws1')]);

  const res = await call(port, 'DELETE', '/api/workspaces/ws1', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(AgentWorkspaceManager.prototype.listOpenshellSandboxes).toHaveBeenCalledWith(undefined);
  expect(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).toHaveBeenCalledWith('ws1', 'gw2');
});

test.each([
  { title: 'unknown to Kaiden', matches: [], status: 404 },
  { title: 'on several gateways', matches: [sandboxes(gateway1, 'ws1'), sandboxes(gateway2, 'ws1')], status: 400 },
])('does not delete a workspace $title', async ({ matches, status }) => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockResolvedValue(matches);

  const res = await call(port, 'DELETE', '/api/workspaces/ws1', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(status);
  expect(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).not.toHaveBeenCalled();
});

test('rejects invalid names and does not leak internal errors', async () => {
  const { port, token } = await startServer();
  const auth = { authorization: `Bearer ${token}` };
  expect((await call(port, 'DELETE', '/api/workspaces/ws1?gateway=a&gateway=b', auth)).status).toBe(400);
  expect((await call(port, 'DELETE', '/api/workspaces/a%20b', auth)).status).toBe(400);

  vi.mocked(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).mockRejectedValue(
    new Error('secret internal detail'),
  );
  const res = await call(port, 'DELETE', '/api/workspaces/ws1', auth);
  expect(res.status).toBe(500);
  expect(res.body).not.toContain('secret internal detail');
  expect(console.error).toHaveBeenCalledWith('API server error deleting workspace', expect.any(Error));
});

test('dispose stops listening and removes the port file', async () => {
  const { port, token, directory } = await startServer();

  await apiServer?.dispose();

  await expect(stat(join(directory, TestApiServer.portFilename))).rejects.toThrow('ENOENT');
  await expect(call(port, 'GET', '/api/workspaces', { authorization: `Bearer ${token}` })).rejects.toThrow(
    'ECONNREFUSED',
  );
});

test('dispose removes its own port file but not one written by another instance', async () => {
  const { directory } = await startServer();
  const portFile = join(directory, TestApiServer.portFilename);
  await writeFile(portFile, '1234\nother-token\n');
  await apiServer?.dispose();
  expect(await readFile(portFile, 'utf-8')).toBe('1234\nother-token\n');
});

test('dispose before init listens leaves no server nor port file behind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  const server = newApiServer(directory);
  apiServer = server;
  const init = server.init();
  await server.dispose();
  await init;

  await expect(stat(join(directory, TestApiServer.portFilename))).rejects.toThrow('ENOENT');
  // dispose waits for init to finish listening, then closes the server
  expect(server.httpServer).toBeUndefined();
  // a later dispose (unbind on shutdown) must not fail on the already closed server
  await expect(server.dispose()).resolves.toBeUndefined();
});

test('dispose while the port file is written leaves no server nor port file behind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  const server = newApiServer(directory);
  apiServer = server;
  let disposing: Promise<void> | undefined;
  vi.mocked(LegacyDirectories.prototype.getDataDirectory).mockImplementation(() => {
    disposing = server.dispose();
    return directory;
  });
  await server.init();
  await disposing;

  await expect(stat(join(directory, TestApiServer.portFilename))).rejects.toThrow('ENOENT');
  expect(server.httpServer).toBeUndefined();
});

test('a port file that cannot be written stops the server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  const server = newApiServer(join(directory, 'missing'));
  apiServer = server;

  await expect(server.init()).rejects.toThrow('ENOENT');
  expect(server.httpServer).toBeUndefined();
});
