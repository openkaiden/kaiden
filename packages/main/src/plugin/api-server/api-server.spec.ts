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

import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { Container } from 'inversify';
import { beforeEach, expect, type Mock, test, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { ConfigurationRegistry } from '/@/plugin/configuration-registry.js';
import { Directories } from '/@/plugin/directories.js';
import { LegacyDirectories } from '/@/plugin/directories-legacy.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { mapSdkSandboxRef } from '/@/plugin/openshell-cli/openshell-sdk-sandbox-mapper.js';
import { IConfigurationRegistry } from '/@api/configuration/models.js';

import { ApiServer } from './api-server.js';

vi.mock(import('/@/plugin/agent-workspace/agent-workspace-manager.js'));
vi.mock(import('/@/plugin/configuration-registry.js'));
vi.mock(import('/@/plugin/directories-legacy.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-state-manager.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-sandbox-mapper.js'));

const sandboxClient = {
  list: vi.fn(),
  delete: vi.fn(),
  execInteractive: vi.fn(),
};
const configurationGet = vi.fn();

let dataDir: string | undefined;
let apiServer: ApiServer | undefined;

function newApiServer(directory: string): ApiServer {
  const container = new Container();
  container.bind(OpenshellGatewayStateManager).toConstantValue(Object.create(OpenshellGatewayStateManager.prototype));
  container.bind(OpenshellSdkClientManager).toConstantValue(Object.create(OpenshellSdkClientManager.prototype));
  vi.mocked(LegacyDirectories.prototype.getDataDirectory).mockReturnValue(directory);
  container.bind(Directories).toConstantValue(Object.create(LegacyDirectories.prototype));
  container.bind(AgentWorkspaceManager).toConstantValue(Object.create(AgentWorkspaceManager.prototype));
  container.bind(IConfigurationRegistry).toConstantValue(Object.create(ConfigurationRegistry.prototype));
  container.bind(ApiServer).toSelf().inSingletonScope();
  return container.get(ApiServer);
}

async function startServer(): Promise<{ port: number; token: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  apiServer = newApiServer(directory);
  await apiServer.init();
  const [port, token] = (await readFile(join(directory, ApiServer.PORT_FILENAME), 'utf-8')).split('\n');
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

async function connect(port: number, token: string, path: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${token}` } });
  await once(ws, 'open');
  return ws;
}

function upgradeStatus(port: number, path: string, headers: Record<string, string>): Promise<number | undefined> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
  return new Promise(resolve => {
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve(undefined));
  });
}

// spies on the real Server.prototype.listen (auto-mocking node:http would remove the server under test)
// to reach the http server ApiServer created and check it stopped listening
function listenedServer(spy: { mock: { contexts: unknown[] } }): Server {
  const server = spy.mock.contexts[0];
  if (!(server instanceof Server)) throw new Error('no server was started');
  return server;
}

function connectionCount(server: Server): Promise<number> {
  return new Promise((resolve, reject) => server.getConnections((err, count) => (err ? reject(err) : resolve(count))));
}

async function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  const [data, isBinary] = (await once(ws, 'message')) as [Buffer, boolean];
  return { data, isBinary };
}

interface FakeExecSession {
  session: {
    write: Mock;
    resize: Mock;
    close: Mock;
    output: AsyncGenerator<{ data: Buffer } | { type: 'exit'; exitCode: number }>;
  };
  exit: (code: number) => void;
}

function fakeExecSession(): FakeExecSession {
  const exited = Promise.withResolvers<number>();
  const session = {
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    output: (async function* (): AsyncGenerator<{ data: Buffer } | { type: 'exit'; exitCode: number }> {
      yield { data: Buffer.from('hello') };
      yield { type: 'exit', exitCode: await exited.promise };
    })(),
  };
  return { session, exit: exited.resolve };
}

beforeEach(async () => {
  await apiServer?.dispose();
  apiServer = undefined;
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
    dataDir = undefined;
  }
  vi.resetAllMocks();
  vi.mocked(ConfigurationRegistry.prototype.getConfiguration).mockReturnValue({
    get: configurationGet,
  } as unknown as ReturnType<ConfigurationRegistry['getConfiguration']>);
  configurationGet.mockReturnValue(true);
  vi.mocked(OpenshellSdkClientManager.prototype.getClient).mockResolvedValue({
    sandbox: sandboxClient,
  } as unknown as OpenShellClient);
  vi.mocked(OpenshellGatewayStateManager.prototype.listGateways).mockReturnValue([
    { name: 'gw1' },
  ] as unknown as ReturnType<OpenshellGatewayStateManager['listGateways']>);
});

test('does not listen when disabled', async () => {
  configurationGet.mockReturnValue(false);
  await expect(startServer()).rejects.toThrow('ENOENT');
  expect(ConfigurationRegistry.prototype.registerConfigurations).toHaveBeenCalled();
});

test('writes an owner-only port file with port and token', async () => {
  const { port, token, directory } = await startServer();
  expect(port).toBeGreaterThan(0);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect((await stat(join(directory, ApiServer.PORT_FILENAME))).mode & 0o777).toBe(0o600);
});

test('rejects requests without the token, with an Origin or with a foreign Host', async () => {
  const { port, token } = await startServer();
  const auth = { authorization: `Bearer ${token}` };
  expect((await call(port, 'GET', '/api/workspaces', {})).status).toBe(401);
  expect((await call(port, 'GET', '/api/workspaces', { authorization: 'Bearer wrong' })).status).toBe(401);
  expect((await call(port, 'GET', '/api/workspaces', { ...auth, origin: 'https://evil.test' })).status).toBe(401);
  expect((await call(port, 'GET', '/api/workspaces', { ...auth, host: `evil.test:${port}` })).status).toBe(401);
  expect(OpenshellGatewayStateManager.prototype.listGateways).not.toHaveBeenCalled();
});

test('accepts localhost as Host', async () => {
  const { port, token } = await startServer();
  sandboxClient.list.mockReturnValue({ all: vi.fn().mockResolvedValue([]) });
  const res = await call(port, 'GET', '/api/workspaces', {
    authorization: `Bearer ${token}`,
    host: `localhost:${port}`,
  });
  expect(res.status).toBe(200);
});

test('lists workspaces of all gateways', async () => {
  const { port, token } = await startServer();
  sandboxClient.list.mockReturnValue({ all: vi.fn().mockResolvedValue([{}]) });
  vi.mocked(mapSdkSandboxRef).mockReturnValue({ id: 'id1', name: 'ws1', phase: 'Ready', resource_version: 3 });

  const res = await call(port, 'GET', '/api/workspaces', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual([
    { id: 'id1', name: 'ws1', phase: 'Ready', labels: {}, resource_version: 3, gateway: 'gw1' },
  ]);
});

test('deletes a workspace on the requested gateway', async () => {
  const { port, token } = await startServer();

  const res = await call(port, 'DELETE', '/api/workspaces/ws1?gateway=gw2', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(OpenshellSdkClientManager.prototype.getClient).toHaveBeenCalledWith('gw2');
  expect(sandboxClient.delete).toHaveBeenCalledWith('ws1');
});

test('rejects invalid names and does not leak internal errors', async () => {
  const { port, token } = await startServer();
  const auth = { authorization: `Bearer ${token}` };
  expect((await call(port, 'DELETE', '/api/workspaces/ws1?gateway=a&gateway=b', auth)).status).toBe(400);
  expect((await call(port, 'DELETE', '/api/workspaces/a%20b', auth)).status).toBe(400);

  sandboxClient.delete.mockRejectedValue(new Error('secret internal detail'));
  const res = await call(port, 'DELETE', '/api/workspaces/ws1', auth);
  expect(res.status).toBe(500);
  expect(res.body).not.toContain('secret internal detail');
});

test('rejects websocket upgrades without the token or with invalid names', async () => {
  const { port, token } = await startServer();
  const auth = { authorization: `Bearer ${token}` };
  expect(await upgradeStatus(port, '/api/workspaces/ws1/pty', {})).toBe(401);
  expect(await upgradeStatus(port, '/api/workspaces/a%20b/pty', auth)).toBe(400);
  expect(await upgradeStatus(port, '/api/workspaces/ws1/pty?gateway=a&gateway=b', auth)).toBe(400);
});

test('pty session queues input sent during setup, clamps sizes and forwards output and exit code', async () => {
  const { port, token } = await startServer();
  const { session, exit } = fakeExecSession();
  const execReady = Promise.withResolvers<typeof session>();
  sandboxClient.execInteractive.mockReturnValue(execReady.promise);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?gateway=gw1');
  ws.send(JSON.stringify({ command: ['bash', '-l'], cols: 100, rows: 30 }));
  ws.send(Buffer.from('typed early'), { binary: true });
  ws.send(JSON.stringify({ type: 'resize', cols: 5000, rows: 40 }));
  await vi.waitFor(() => expect(sandboxClient.execInteractive).toHaveBeenCalled());
  const output = nextMessage(ws);
  execReady.resolve(session);

  expect(await output).toEqual({ data: Buffer.from('hello'), isBinary: true });
  expect(OpenshellSdkClientManager.prototype.getClient).toHaveBeenCalledWith('gw1');
  expect(sandboxClient.execInteractive).toHaveBeenCalledWith('ws1', ['bash', '-l'], {
    tty: true,
    cols: 100,
    rows: 30,
    signal: expect.any(AbortSignal),
  });
  expect(session.write).toHaveBeenCalledWith(Buffer.from('typed early'));
  expect(session.resize).toHaveBeenCalledWith(80, 40);

  const exitFrame = nextMessage(ws);
  exit(3);
  expect(JSON.parse((await exitFrame).data.toString())).toEqual({ type: 'exit', exitCode: 3 });
  await once(ws, 'close');
});

test('pty session falls back to /bin/sh and aborts when the client disconnects', async () => {
  const { port, token } = await startServer();
  const { session } = fakeExecSession();
  sandboxClient.execInteractive.mockResolvedValue(session);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const output = nextMessage(ws);
  ws.send(JSON.stringify({ command: [1] }));
  await output;
  ws.close();

  await vi.waitFor(() => expect(session.close).toHaveBeenCalled());
  const signal: AbortSignal = sandboxClient.execInteractive.mock.calls[0]?.[2].signal;
  expect(signal.aborted).toBe(true);
  expect(sandboxClient.execInteractive).toHaveBeenCalledWith('ws1', ['/bin/sh'], expect.anything());
});

test('agent session decodes multibyte input split across frames and detaches on close', async () => {
  const { port, token } = await startServer();
  const terminal = { write: vi.fn(), resize: vi.fn(), detach: vi.fn() };
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockResolvedValue(terminal);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  ws.send(JSON.stringify({ cols: 120, rows: 40 }));
  const e = Buffer.from('é');
  ws.send(e.subarray(0, 1), { binary: true });
  ws.send(e.subarray(1), { binary: true });

  await vi.waitFor(() => expect(terminal.write.mock.calls.map(c => c[0]).join('')).toBe('é'));
  expect(terminal.resize).toHaveBeenCalledWith(120, 40);
  ws.close();
  await vi.waitFor(() => expect(terminal.detach).toHaveBeenCalled());
});

test.each([
  'resolves',
  'rejects',
])('agent attach that %s after the client left detaches and is not reported as a failure', async outcome => {
  const listenSpy = vi.spyOn(Server.prototype, 'listen');
  const { port, token } = await startServer();
  const terminal = { write: vi.fn(), resize: vi.fn(), detach: vi.fn() };
  const attached = Promise.withResolvers<typeof terminal>();
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockReturnValue(attached.promise);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  ws.send(JSON.stringify({}));
  await vi.waitFor(() => expect(AgentWorkspaceManager.prototype.attachAgentTerminal).toHaveBeenCalled());
  ws.close();
  // the server has seen the disconnect once its upgraded socket is gone
  await vi.waitFor(async () => expect(await connectionCount(listenedServer(listenSpy))).toBe(0));
  if (outcome === 'resolves') {
    attached.resolve(terminal);
    await vi.waitFor(() => expect(terminal.detach).toHaveBeenCalled());
  } else {
    attached.reject(new Error('attach failed'));
  }

  // let a late rejection or #sendError run before asserting that nothing was logged
  await new Promise(resolve => setImmediate(resolve));
  expect(errorSpy).not.toHaveBeenCalled();
});

test('agent stderr is forwarded as terminal output and keeps the session open', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockImplementation(async (_name, _gw, client) => {
    client.onError?.('warning on stderr');
    return { write: vi.fn(), resize: vi.fn(), detach: vi.fn() };
  });

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  const message = nextMessage(ws);
  ws.send(JSON.stringify({}));
  expect(await message).toEqual({ data: Buffer.from('warning on stderr'), isBinary: true });
  expect(ws.readyState).toBe(WebSocket.OPEN);
});

test.each([
  'resolves',
  'rejects',
])('pty session opening that %s after the client left is closed and not reported as a failure', async outcome => {
  const { port, token } = await startServer();
  const { session } = fakeExecSession();
  // settle only once the server has seen the disconnect, like the SDK honouring the abort signal
  sandboxClient.execInteractive.mockImplementation(
    (_name: string, _command: string[], options: { signal: AbortSignal }) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener('abort', () =>
          outcome === 'resolves' ? resolve(session) : reject(new Error('aborted')),
        ),
      ),
  );
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  ws.send(JSON.stringify({}));
  await vi.waitFor(() => expect(sandboxClient.execInteractive).toHaveBeenCalled());
  ws.close();

  const signal: AbortSignal = sandboxClient.execInteractive.mock.calls[0]?.[2].signal;
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  if (outcome === 'resolves') {
    await vi.waitFor(() => expect(session.close).toHaveBeenCalled());
  }
  // let a late rejection or #sendError run before asserting that nothing was logged
  await new Promise(resolve => setImmediate(resolve));
  expect(errorSpy).not.toHaveBeenCalled();
});

test('a protocol error on a websocket does not crash the server', async () => {
  const { port, token } = await startServer();
  sandboxClient.list.mockReturnValue({ all: vi.fn().mockResolvedValue([]) });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/workspaces/ws1/pty`, {
    headers: { authorization: `Bearer ${token}` },
  });
  // 'open' follows 'upgrade' in the same tick: listen to both before awaiting
  const upgraded = once(ws, 'upgrade');
  const opened = once(ws, 'open');
  const [response] = (await upgraded) as [{ socket: Duplex }];
  await opened;
  const closed = once(ws, 'close');
  // masked frame with reserved opcode 0x3: the server must reject it through the websocket 'error' event
  response.socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
  await closed;

  expect((await call(port, 'GET', '/api/workspaces', { authorization: `Bearer ${token}` })).status).toBe(200);
});

test('dispose closes open terminals and removes the port file', async () => {
  const { port, token, directory } = await startServer();
  const { session } = fakeExecSession();
  sandboxClient.execInteractive.mockResolvedValue(session);
  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const output = nextMessage(ws);
  ws.send(JSON.stringify({}));
  await output;

  const closed = once(ws, 'close');
  await apiServer?.dispose();
  await closed;

  await expect(stat(join(directory, ApiServer.PORT_FILENAME))).rejects.toThrow('ENOENT');
  await vi.waitFor(() => expect(session.close).toHaveBeenCalled());
});

test('dispose removes its own port file but not one written by another instance', async () => {
  const { directory } = await startServer();
  const portFile = join(directory, ApiServer.PORT_FILENAME);
  await writeFile(portFile, '1234\nother-token\n');
  await apiServer?.dispose();
  expect(await readFile(portFile, 'utf-8')).toBe('1234\nother-token\n');
});

test('dispose before init listens leaves no server nor port file behind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  apiServer = newApiServer(directory);
  const listenSpy = vi.spyOn(Server.prototype, 'listen');
  const init = apiServer.init();
  await apiServer.dispose();
  await init;

  await expect(stat(join(directory, ApiServer.PORT_FILENAME))).rejects.toThrow('ENOENT');
  expect(listenedServer(listenSpy).listening).toBe(false);
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
  const listenSpy = vi.spyOn(Server.prototype, 'listen');
  await server.init();
  await disposing;

  await expect(stat(join(directory, ApiServer.PORT_FILENAME))).rejects.toThrow('ENOENT');
  expect(listenedServer(listenSpy).listening).toBe(false);
});

test('a port file that cannot be written stops the server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'api-server-'));
  dataDir = directory;
  apiServer = newApiServer(join(directory, 'missing'));
  const listenSpy = vi.spyOn(Server.prototype, 'listen');

  await expect(apiServer.init()).rejects.toThrow('ENOENT');
  expect(listenedServer(listenSpy).listening).toBe(false);
});
