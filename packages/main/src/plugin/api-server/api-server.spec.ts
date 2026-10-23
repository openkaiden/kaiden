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
import { IncomingMessage, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type ExecInteractiveSessionControl,
  type ExecStreamEvent,
  OpenShellClient,
  SandboxClient,
} from '@nvidia/openshell-sdk';
import type { Configuration } from '@openkaiden/api';
import { Container, injectable, injectFromBase } from 'inversify';
import { assert, beforeEach, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { ConfigurationRegistry } from '/@/plugin/configuration-registry.js';
import { Directories } from '/@/plugin/directories.js';
import { LegacyDirectories } from '/@/plugin/directories-legacy.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { GatewayInfo, GatewaySandboxes, SandboxMatch } from '/@api/openshell-gateway-info.js';

import { ApiServer } from './api-server.js';

vi.mock(import('@nvidia/openshell-sdk'));
vi.mock(import('/@/plugin/agent-workspace/agent-workspace-manager.js'));
vi.mock(import('/@/plugin/configuration-registry.js'));
vi.mock(import('/@/plugin/directories-legacy.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));

@injectable()
@injectFromBase()
class TestApiServer extends ApiServer {
  static get portFilename(): string {
    return this.PORT_FILENAME;
  }

  static lookupError(failure: 'not-found' | 'ambiguous'): string {
    return this.LOOKUP_ERRORS[failure];
  }

  get httpServer(): Server | undefined {
    return this.server;
  }
}

const GW1: GatewayInfo = { name: 'gw1', endpoint: 'http://localhost:1', canStop: false };
const GW2: GatewayInfo = { name: 'gw2', endpoint: 'http://localhost:2', canStop: false };

let configuration: Configuration;
let dataDir: string | undefined;
let apiServer: TestApiServer | undefined;

function newApiServer(directory: string): TestApiServer {
  const container = new Container();
  container.bind(OpenshellSdkClientManager).toConstantValue(Object.create(OpenshellSdkClientManager.prototype));
  vi.mocked(LegacyDirectories.prototype.getDataDirectory).mockReturnValue(directory);
  container.bind(Directories).toConstantValue(Object.create(LegacyDirectories.prototype));
  container.bind(AgentWorkspaceManager).toConstantValue(Object.create(AgentWorkspaceManager.prototype));
  container.bind(IConfigurationRegistry).toConstantValue(Object.create(ConfigurationRegistry.prototype));
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

function connectionCount(server: Server | undefined): Promise<number> {
  assert(server);
  return new Promise((resolve, reject) => server.getConnections((err, count) => (err ? reject(err) : resolve(count))));
}

async function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  const [data, isBinary] = await once(ws, 'message');
  assert(Buffer.isBuffer(data) && typeof isBinary === 'boolean');
  return { data, isBinary };
}

// a promise that never settles: the operation stays in progress for the whole test
function never(): Promise<never> {
  return new Promise<never>(() => {});
}

function found(name: string, gateway: string, labels?: Record<string, string>): SandboxMatch {
  return { sandbox: { id: `id-${name}`, name, phase: 'Ready', labels }, gateway };
}

function sandboxes(gateway: GatewayInfo, ...names: string[]): GatewaySandboxes {
  return { gateway, sandboxes: names.map(name => ({ id: `id-${name}`, name, phase: 'Ready' })) };
}

function fakeExecSession(output?: AsyncIterable<ExecStreamEvent>): {
  session: ExecInteractiveSessionControl;
  exit: (code: number) => void;
} {
  const exited = Promise.withResolvers<number>();
  const session: ExecInteractiveSessionControl = {
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeInput: vi.fn(),
    cancel: vi.fn(),
    exitCode: undefined,
    done: exited.promise,
    output:
      output ??
      (async function* (): AsyncGenerator<ExecStreamEvent> {
        yield { stream: 'stdout', data: Buffer.from('hello') };
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
  console.error = vi.fn();
  console.warn = vi.fn();
  configuration = { get: vi.fn(), has: vi.fn(), update: vi.fn() };
  vi.mocked(configuration.get).mockReturnValue(true);
  vi.mocked(ConfigurationRegistry.prototype.getConfiguration).mockReturnValue(configuration);
  const client: OpenShellClient = Object.assign(Object.create(OpenShellClient.prototype), {
    sandbox: Object.create(SandboxClient.prototype),
  });
  vi.mocked(OpenshellSdkClientManager.prototype.getClient).mockResolvedValue(client);
  vi.mocked(AgentWorkspaceManager.prototype.listOpenshellSandboxes).mockResolvedValue([]);
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockResolvedValue([found('ws1', 'gw1')]);
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

test('writes an owner-only port file with port and token', async () => {
  const { port, token, directory } = await startServer();
  expect(port).toBeGreaterThan(0);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect((await stat(join(directory, TestApiServer.portFilename))).mode & 0o777).toBe(0o600);
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
      gateway: GW1,
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
    sandboxes(GW2, 'ws2'),
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
      resource_version: 3,
      source_path: '/home/user/project',
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

test('deletes a workspace on the requested gateway with the labels found by the lookup', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockResolvedValue([
    found('ws1', 'gw2', { a: 'b' }),
  ]);

  const res = await call(port, 'DELETE', '/api/workspaces/ws1?gateway=gw2', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ deleted: true });
  expect(AgentWorkspaceManager.prototype.findOpenshellSandboxes).toHaveBeenCalledWith('ws1', 'gw2');
  expect(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).toHaveBeenCalledWith('ws1', 'gw2', { a: 'b' });
});

test('deletes a workspace on the only gateway that has it when no gateway is given', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockResolvedValue([found('ws1', 'gw2')]);

  const res = await call(port, 'DELETE', '/api/workspaces/ws1', { authorization: `Bearer ${token}` });

  expect(res.status).toBe(200);
  expect(AgentWorkspaceManager.prototype.findOpenshellSandboxes).toHaveBeenCalledWith('ws1', undefined);
  expect(AgentWorkspaceManager.prototype.deleteOpenshellSandbox).toHaveBeenCalledWith('ws1', 'gw2', {});
});

test.each([
  { title: 'unknown to Kaiden', matches: [], status: 404 },
  { title: 'on several gateways', matches: [found('ws1', 'gw1'), found('ws1', 'gw2')], status: 400 },
])('does not delete a workspace $title', async ({ matches, status }) => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockResolvedValue(matches);

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
  const execReady = Promise.withResolvers<ExecInteractiveSessionControl>();
  vi.mocked(SandboxClient.prototype.execInteractive).mockReturnValue(execReady.promise);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?gateway=gw1');
  ws.send(JSON.stringify({ command: ['bash', '-l'], cols: 100, rows: 30 }));
  ws.send(Buffer.from('typed early'), { binary: true });
  ws.send(JSON.stringify({ type: 'resize', cols: 5000, rows: 40 }));
  await vi.waitFor(() => expect(SandboxClient.prototype.execInteractive).toHaveBeenCalled());
  const output = nextMessage(ws);
  execReady.resolve(session);

  expect(await output).toEqual({ data: Buffer.from('hello'), isBinary: true });
  expect(OpenshellSdkClientManager.prototype.getClient).toHaveBeenCalledWith('gw1');
  expect(SandboxClient.prototype.execInteractive).toHaveBeenCalledWith('ws1', ['bash', '-l'], {
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
  vi.mocked(SandboxClient.prototype.execInteractive).mockResolvedValue(session);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const output = nextMessage(ws);
  ws.send(JSON.stringify({ command: [1] }));
  await output;
  ws.close();

  await vi.waitFor(() => expect(session.close).toHaveBeenCalled());
  const signal = vi.mocked(SandboxClient.prototype.execInteractive).mock.calls[0]?.[2]?.signal;
  expect(signal?.aborted).toBe(true);
  expect(SandboxClient.prototype.execInteractive).toHaveBeenCalledWith('ws1', ['/bin/sh'], expect.anything());
});

test('pty output stream failing while connected sends an error and closes the socket', async () => {
  const { port, token } = await startServer();
  const { session } = fakeExecSession({
    [Symbol.asyncIterator]: (): AsyncIterator<ExecStreamEvent> => ({
      next: () => Promise.reject(new Error('stream broke')),
    }),
  });
  vi.mocked(SandboxClient.prototype.execInteractive).mockResolvedValue(session);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const message = nextMessage(ws);
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({}));

  expect(JSON.parse((await message).data.toString())).toEqual({ type: 'error', error: 'Failed: terminal session' });
  await closed;
  expect(console.error).toHaveBeenCalledWith('API server terminal session:', expect.any(Error));
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

test('agent session end sends an exit frame and closes the socket', async () => {
  const { port, token } = await startServer();
  const attached = Promise.withResolvers<() => void>();
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockImplementation(async (_name, _gw, client) => {
    attached.resolve(() => client.onEnd?.());
    return { write: vi.fn(), resize: vi.fn(), detach: vi.fn() };
  });

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  const message = nextMessage(ws);
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({}));
  (await attached.promise)();

  expect(JSON.parse((await message).data.toString())).toEqual({ type: 'exit', exitCode: 0 });
  await closed;
});

test('agent attach failing while connected sends an error and closes the socket', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockRejectedValue(new Error('attach failed'));

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  const message = nextMessage(ws);
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({}));

  expect(JSON.parse((await message).data.toString())).toEqual({ type: 'error', error: 'Failed: agent session' });
  await closed;
  expect(console.error).toHaveBeenCalledWith('API server agent session:', expect.any(Error));
});

test.each([
  'resolves',
  'rejects',
])('agent attach that %s after the client left detaches and is not reported as a failure', async outcome => {
  const { port, token } = await startServer();
  const terminal = { write: vi.fn(), resize: vi.fn(), detach: vi.fn() };
  const attached = Promise.withResolvers<typeof terminal>();
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockReturnValue(attached.promise);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  ws.send(JSON.stringify({}));
  await vi.waitFor(() => expect(AgentWorkspaceManager.prototype.attachAgentTerminal).toHaveBeenCalled());
  ws.close();
  // the server has seen the disconnect once its upgraded socket is gone
  await vi.waitFor(async () => expect(await connectionCount(apiServer?.httpServer)).toBe(0));
  if (outcome === 'resolves') {
    attached.resolve(terminal);
    await vi.waitFor(() => expect(terminal.detach).toHaveBeenCalled());
  } else {
    attached.reject(new Error('attach failed'));
  }

  // let a late rejection or #sendError run before asserting that nothing was logged
  await new Promise(resolve => setImmediate(resolve));
  expect(console.error).not.toHaveBeenCalled();
});

test('agent session is not attached when the client leaves during the workspace lookup', async () => {
  const { port, token } = await startServer();
  const lookup = Promise.withResolvers<SandboxMatch[]>();
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockReturnValue(lookup.promise);

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  ws.send(JSON.stringify({}));
  await vi.waitFor(() => expect(AgentWorkspaceManager.prototype.findOpenshellSandboxes).toHaveBeenCalled());
  ws.close();
  await vi.waitFor(async () => expect(await connectionCount(apiServer?.httpServer)).toBe(0));
  lookup.resolve([found('ws1', 'gw1')]);

  // let the resolved lookup run before asserting that nothing was attached
  await new Promise(resolve => setImmediate(resolve));
  expect(AgentWorkspaceManager.prototype.attachAgentTerminal).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
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
  vi.mocked(SandboxClient.prototype.execInteractive).mockImplementation(
    (_name, _command, options) =>
      new Promise((resolve, reject) =>
        options?.signal?.addEventListener('abort', () =>
          outcome === 'resolves' ? resolve(session) : reject(new Error('aborted')),
        ),
      ),
  );

  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  ws.send(JSON.stringify({}));
  await vi.waitFor(() => expect(SandboxClient.prototype.execInteractive).toHaveBeenCalled());
  ws.close();

  const signal = vi.mocked(SandboxClient.prototype.execInteractive).mock.calls[0]?.[2]?.signal;
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  if (outcome === 'resolves') {
    await vi.waitFor(() => expect(session.close).toHaveBeenCalled());
  }
  // let a late rejection or #sendError run before asserting that nothing was logged
  await new Promise(resolve => setImmediate(resolve));
  expect(console.error).not.toHaveBeenCalled();
});

test.each([
  { title: 'unknown to Kaiden', matches: [], error: TestApiServer.lookupError('not-found') },
  {
    title: 'on several gateways',
    matches: [found('ws1', 'gw1'), found('ws1', 'gw2')],
    error: TestApiServer.lookupError('ambiguous'),
  },
])('terminals refuse a workspace $title', async ({ matches, error }) => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockResolvedValue(matches);

  for (const path of ['/api/workspaces/ws1/pty', '/api/workspaces/ws1/pty?agent=true']) {
    const ws = await connect(port, token, path);
    const message = nextMessage(ws);
    const closed = once(ws, 'close');
    ws.send(JSON.stringify({}));
    expect(JSON.parse((await message).data.toString())).toEqual({ type: 'error', error });
    await closed;
  }
  expect(SandboxClient.prototype.execInteractive).not.toHaveBeenCalled();
  expect(AgentWorkspaceManager.prototype.attachAgentTerminal).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

test('terminals open on the gateway the lookup found', async () => {
  const { port, token } = await startServer();
  vi.mocked(AgentWorkspaceManager.prototype.findOpenshellSandboxes).mockResolvedValue([found('ws1', 'gw2')]);
  vi.mocked(AgentWorkspaceManager.prototype.attachAgentTerminal).mockResolvedValue({
    write: vi.fn(),
    resize: vi.fn(),
    detach: vi.fn(),
  });

  const ws = await connect(port, token, '/api/workspaces/ws1/pty?agent=true');
  ws.send(JSON.stringify({}));

  await vi.waitFor(() =>
    expect(AgentWorkspaceManager.prototype.attachAgentTerminal).toHaveBeenCalledWith('ws1', 'gw2', expect.anything()),
  );
  expect(AgentWorkspaceManager.prototype.findOpenshellSandboxes).toHaveBeenCalledWith('ws1', undefined);
});

test('a frame larger than 1 MiB closes the socket', async () => {
  const { port, token } = await startServer();
  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const closed = once(ws, 'close');

  ws.send(Buffer.alloc(1024 * 1024 + 1), { binary: true });

  expect((await closed)[0]).toBe(1009);
});

test('more than 1 MiB of input before the session starts closes the socket', async () => {
  const { port, token } = await startServer();
  vi.mocked(SandboxClient.prototype.execInteractive).mockReturnValue(never());
  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const closed = once(ws, 'close');

  ws.send(JSON.stringify({}));
  for (let i = 0; i < 3; i++) ws.send(Buffer.alloc(512 * 1024), { binary: true });

  expect((await closed)[0]).toBe(1009);
});

test('a protocol error on a websocket does not crash the server', async () => {
  const { port, token } = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/workspaces/ws1/pty`, {
    headers: { authorization: `Bearer ${token}` },
  });
  // 'open' follows 'upgrade' in the same tick: listen to both before awaiting
  const upgraded = once(ws, 'upgrade');
  const opened = once(ws, 'open');
  const [response] = await upgraded;
  assert(response instanceof IncomingMessage);
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
  vi.mocked(SandboxClient.prototype.execInteractive).mockResolvedValue(session);
  const ws = await connect(port, token, '/api/workspaces/ws1/pty');
  const output = nextMessage(ws);
  ws.send(JSON.stringify({}));
  await output;

  const closed = once(ws, 'close');
  await apiServer?.dispose();
  await closed;

  await expect(stat(join(directory, TestApiServer.portFilename))).rejects.toThrow('ENOENT');
  await vi.waitFor(() => expect(session.close).toHaveBeenCalled());
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
  // init closes the server it created once it sees the dispose
  expect(server.httpServer?.listening).toBe(false);
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
