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

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { join } from 'node:path';

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import express, { type NextFunction, type Request, type Response } from 'express';
import { inject, injectable, preDestroy } from 'inversify';
import { type WebSocket, WebSocketServer } from 'ws';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { Directories } from '/@/plugin/directories.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { ApiServerSettings } from '/@api/api-server-settings.js';
import type { ApiWorkspace } from '/@api/api-workspace.js';
import { type IConfigurationNode, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { IDisposable } from '/@api/disposable.js';

interface ControlMessage {
  type?: unknown;
  cols?: unknown;
  rows?: unknown;
  command?: unknown;
}

type LookupFailure = 'not-found' | 'ambiguous';

interface TerminalSession {
  write(data: Buffer): void;
  resize(cols: number, rows: number): void;
}

@injectable()
export class ApiServer {
  protected static readonly PORT_FILENAME = 'api-port';
  protected static readonly NAME_PATTERN = /^[\w.-]{1,253}$/;
  // terminal input is small: bounds both a single frame and the input queued while a session starts
  protected static readonly MAX_INPUT_BYTES = 1024 * 1024;
  protected static readonly LOOKUP_ERRORS: Record<LookupFailure, string> = {
    'not-found': 'Workspace not found',
    ambiguous: 'Workspace exists on several gateways, pass ?gateway=',
  };
  protected static readonly DEFAULT_COLS = 80;
  protected static readonly DEFAULT_ROWS = 24;
  protected static readonly DEFAULT_SHELL = '/bin/sh';

  constructor(
    @inject(OpenshellSdkClientManager) private sdkClientManager: OpenshellSdkClientManager,
    @inject(Directories) private directories: Directories,
    @inject(AgentWorkspaceManager) private agentWorkspaceManager: AgentWorkspaceManager,
    @inject(IConfigurationRegistry) private configurationRegistry: IConfigurationRegistry,
  ) {}

  protected server: Server | undefined;
  #wss: WebSocketServer | undefined;
  #port = 0;
  #portFilePath: string | undefined;
  #disposed = false;
  // clients read it from the port file (owner-only) and send it as a bearer token
  #token = '';
  #configurationListener: IDisposable | undefined;
  // start and stop run one after the other so quick toggles and dispose never interleave
  #transition: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    const enabledKey = `${ApiServerSettings.SectionName}.${ApiServerSettings.Enabled}`;
    const configurationNode: IConfigurationNode = {
      id: 'preferences.api.server',
      title: 'Local API server',
      type: 'object',
      properties: {
        [enabledKey]: {
          description:
            'Expose a local API on 127.0.0.1 so local REST and WebSocket clients can list, delete and open terminals on workspaces.',
          type: 'boolean',
          default: true,
        },
      },
    };
    this.configurationRegistry.registerConfigurations([configurationNode]);
    this.#configurationListener = this.configurationRegistry.onDidChangeConfiguration(event => {
      if (event.key === enabledKey) {
        this.#applyEnabled().catch((err: unknown) => console.error('API server: failed to apply the setting', err));
      }
    });
    await this.#applyEnabled();
  }

  #applyEnabled(): Promise<void> {
    const enabled = this.configurationRegistry
      .getConfiguration(ApiServerSettings.SectionName)
      .get<boolean>(ApiServerSettings.Enabled);
    return this.#enqueue(() => (enabled ? this.#start() : this.#stop()));
  }

  #enqueue(transition: () => Promise<void>): Promise<void> {
    const next = this.#transition.then(transition);
    // the caller gets the error through `next`; the queue itself keeps going
    this.#transition = next.catch(() => undefined);
    return next;
  }

  async #start(): Promise<void> {
    if (this.#disposed || this.server) return;
    this.#token = randomBytes(32).toString('hex');

    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
      if (this.isAuthorized(req.headers)) {
        next();
      } else {
        res.status(401).end();
      }
    });

    app.get('/api/workspaces', (_req, res) => {
      this.#sendWorkspaces(res).catch((err: unknown) => console.error('API server: failed to answer list', err));
    });

    app.delete('/api/workspaces/:name', (req, res) => {
      const name = req.params.name;
      const gateway = req.query['gateway'];
      if (!this.isValidName(name) || (gateway !== undefined && !this.isValidName(gateway))) {
        res.status(400).json({ error: 'Invalid workspace or gateway name' });
        return;
      }
      this.#sendDelete(res, name, gateway).catch((err: unknown) =>
        console.error('API server: failed to answer delete', err),
      );
    });

    // keep the JSON error contract for unknown routes and errors raised by express itself
    app.use((_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error('API server: request failed', err);
      // express flags client errors such as a malformed percent-encoding with status 400
      const badRequest = err instanceof Error && 'status' in err && err.status === 400;
      res.status(badRequest ? 400 : 500).json({ error: badRequest ? 'Bad request' : 'Request failed' });
    });

    const server = createServer(app);
    const wss = new WebSocketServer({ noServer: true, maxPayload: ApiServer.MAX_INPUT_BYTES });
    server.on('upgrade', (request, socket, head) => {
      if (!this.isAuthorized(request.headers)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return;
      }
      const url = new URL(request.url ?? '', `http://127.0.0.1:${this.#port}`);
      const sandboxName = this.#decodeSegment(/^\/api\/workspaces\/([^/]+)\/pty$/.exec(url.pathname)?.[1]);
      const gateways = url.searchParams.getAll('gateway');
      const gateway = gateways[0];
      if (
        !this.isValidName(sandboxName) ||
        gateways.length > 1 ||
        (gateway !== undefined && !this.isValidName(gateway))
      ) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      wss.handleUpgrade(request, socket, head, ws => {
        ws.on('error', err => console.debug('API server: websocket error', err));
        if (url.searchParams.get('agent') === 'true') {
          this.#handleAgentConnection(ws, sandboxName, gateway);
        } else {
          this.#handlePtyConnection(ws, sandboxName, gateway);
        }
      });
    });

    // port 0: the OS picks a free port atomically, no check-then-bind race
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', err => console.error('API server error', err));
    this.server = server;
    // listen() on a host and port always yields an AddressInfo, the check only narrows the type
    const address = server.address();
    this.#port = address && typeof address !== 'string' ? address.port : 0;
    this.#wss = wss;

    // recreate so a stale world-readable file (or planted symlink) never receives the token
    const portFilePath = join(this.directories.getDataDirectory(), ApiServer.PORT_FILENAME);
    try {
      await rm(portFilePath, { force: true });
      await writeFile(portFilePath, `${this.#port}\n${this.#token}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    } catch (err: unknown) {
      // nobody could discover this server without its port file
      await this.#stop();
      throw err;
    }
    this.#portFilePath = portFilePath;
    console.log(`API server listening on 127.0.0.1:${this.#port}`);
  }

  // browser requests carry an Origin and DNS-rebound ones a foreign Host: reject both, then require the bearer token
  isAuthorized(headers: IncomingHttpHeaders): boolean {
    if (headers.origin !== undefined) return false;
    if (headers.host !== `127.0.0.1:${this.#port}` && headers.host !== `localhost:${this.#port}`) return false;
    const expected = Buffer.from(`Bearer ${this.#token}`);
    const actual = Buffer.from(headers.authorization ?? '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  isValidName(value: unknown): value is string {
    return typeof value === 'string' && ApiServer.NAME_PATTERN.test(value);
  }

  // the manager only lists Kaiden workspaces and decodes their source path
  async listWorkspaces(): Promise<ApiWorkspace[]> {
    const gateways = await this.agentWorkspaceManager.listOpenshellSandboxes();
    return gateways.flatMap(({ gateway, sandboxes }) =>
      sandboxes.map(sandbox => ({
        id: sandbox.id,
        name: sandbox.name,
        phase: sandbox.phase,
        labels: sandbox.labels ?? {},
        resourceVersion: sandbox.resource_version,
        sourcePath: sandbox.sourcePath,
        gateway: gateway.name,
      })),
    );
  }

  // every route only reaches Kaiden workspaces; without a gateway the name must be unique across gateways.
  // a gateway that fails to list is skipped (and logged) by the manager, so its workspaces count as missing
  async #findWorkspace(name: string, gateway?: string): Promise<{ gateway: string } | LookupFailure> {
    const matches = (await this.agentWorkspaceManager.listOpenshellSandboxes(gateway)).filter(entry =>
      entry.sandboxes.some(sandbox => sandbox.name === name),
    );
    const [match] = matches;
    if (!match) return 'not-found';
    if (matches.length > 1) return 'ambiguous';
    return { gateway: match.gateway.name };
  }

  async deleteWorkspace(name: string, gateway?: string): Promise<'deleted' | LookupFailure> {
    const match = await this.#findWorkspace(name, gateway);
    if (typeof match === 'string') return match;
    // the manager also removes the linked secret, profile, config dir and terminals
    await this.agentWorkspaceManager.deleteOpenshellSandbox(name, match.gateway);
    return 'deleted';
  }

  #sendLookupFailure(ws: WebSocket, failure: LookupFailure): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: ApiServer.LOOKUP_ERRORS[failure] }));
      ws.close();
    }
  }

  // express 4 ignores promises returned by handlers: each route answers its own errors
  async #sendWorkspaces(res: Response): Promise<void> {
    try {
      res.json(await this.listWorkspaces());
    } catch (err: unknown) {
      console.error('API server error listing workspaces', err);
      res.status(500).json({ error: 'Failed to list workspaces' });
    }
  }

  async #sendDelete(res: Response, name: string, gateway?: string): Promise<void> {
    try {
      const result = await this.deleteWorkspace(name, gateway);
      if (result === 'deleted') {
        res.json({ deleted: true });
      } else if (result === 'not-found') {
        res.status(404).json({ error: ApiServer.LOOKUP_ERRORS[result] });
      } else {
        res.status(400).json({ error: ApiServer.LOOKUP_ERRORS[result] });
      }
    } catch (err: unknown) {
      console.error('API server error deleting workspace', err);
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  }

  #decodeSegment(segment: string | undefined): string | undefined {
    if (segment === undefined) return undefined;
    try {
      return decodeURIComponent(segment);
    } catch (err: unknown) {
      console.debug(`API server: invalid path segment "${segment}"`, err);
      return undefined;
    }
  }

  #isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
  }

  #dimension(value: unknown, fallback: number): number {
    return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 1000 ? Number(value) : fallback;
  }

  #parseControl(data: Buffer): ControlMessage {
    try {
      const parsed: unknown = JSON.parse(data.toString());
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (err: unknown) {
      console.debug('API server: ignoring malformed control message', err);
      return {};
    }
  }

  #sendError(ws: WebSocket, context: string, err: unknown): void {
    console.error(`API server ${context}:`, err);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', error: `Failed: ${context}` }));
      ws.close();
    }
  }

  // the first text frame starts the session; frames received while it is being set up are queued, not dropped
  #serveTerminal(
    ws: WebSocket,
    context: string,
    open: (start: ControlMessage) => Promise<TerminalSession | undefined>,
  ): void {
    let session: TerminalSession | undefined;
    let starting = false;
    const pending: [Buffer, boolean][] = [];
    let pendingBytes = 0;
    const handle = (target: TerminalSession, data: Buffer, isBinary: boolean): void => {
      if (isBinary) {
        target.write(data);
        return;
      }
      const msg = this.#parseControl(data);
      if (msg.type === 'resize') {
        target.resize(
          this.#dimension(msg.cols, ApiServer.DEFAULT_COLS),
          this.#dimension(msg.rows, ApiServer.DEFAULT_ROWS),
        );
      }
    };
    const start = async (data: Buffer): Promise<void> => {
      try {
        const opened = await open(this.#parseControl(data));
        session = opened;
        const queued = pending.splice(0);
        if (opened) {
          for (const [data, isBinary] of queued) handle(opened, data, isBinary);
        }
      } catch (err: unknown) {
        pending.length = 0;
        this.#sendError(ws, context, err);
      }
    };
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (session) {
        handle(session, data, isBinary);
      } else if (starting) {
        pendingBytes += data.length;
        if (pendingBytes > ApiServer.MAX_INPUT_BYTES) {
          pending.length = 0;
          ws.close(1009, 'Too much input before the session started');
          return;
        }
        pending.push([data, isBinary]);
      } else {
        starting = true;
        start(data).catch((err: unknown) => console.error(`API server: failed to start ${context}`, err));
      }
    });
  }

  #handlePtyConnection(ws: WebSocket, sandboxName: string, gatewayName?: string): void {
    const abortController = new AbortController();
    ws.on('close', () => abortController.abort());
    this.#serveTerminal(ws, 'terminal session', async start => {
      const command =
        this.#isStringArray(start.command) && start.command.length ? start.command : [ApiServer.DEFAULT_SHELL];
      let execSession: Awaited<ReturnType<OpenShellClient['sandbox']['execInteractive']>>;
      try {
        const match = await this.#findWorkspace(sandboxName, gatewayName);
        if (typeof match === 'string') {
          this.#sendLookupFailure(ws, match);
          return undefined;
        }
        const client = await this.sdkClientManager.getClient(match.gateway);
        execSession = await client.sandbox.execInteractive(sandboxName, command, {
          tty: true,
          cols: this.#dimension(start.cols, ApiServer.DEFAULT_COLS),
          rows: this.#dimension(start.rows, ApiServer.DEFAULT_ROWS),
          signal: abortController.signal,
        });
      } catch (err: unknown) {
        // the client left while the session was opening: a normal end, not a failure
        if (abortController.signal.aborted) {
          console.debug(
            `API server: client left while opening terminal session on "${sandboxName}" (gateway ${gatewayName ?? 'any'})`,
            err,
          );
          return undefined;
        }
        throw err;
      }
      if (abortController.signal.aborted) {
        execSession.close();
        return undefined;
      }
      ws.on('close', () => execSession.close());

      (async (): Promise<void> => {
        for await (const event of execSession.output) {
          if (ws.readyState !== ws.OPEN) break;
          if ('type' in event) {
            ws.send(JSON.stringify({ type: 'exit', exitCode: event.exitCode }));
            break;
          }
          ws.send(event.data);
        }
        if (ws.readyState === ws.OPEN) {
          ws.close();
        }
      })().catch((err: unknown) => {
        // the stream throws once the client disconnects and the session is aborted: that is a normal end
        if (!abortController.signal.aborted) {
          this.#sendError(ws, 'terminal session', err);
        }
      });

      return {
        write: (data): void => execSession.write(Buffer.from(data)),
        resize: (cols, rows): void => execSession.resize(cols, rows),
      };
    });
  }

  // attaches to the agent session shared with the UI: closing the socket detaches without stopping the agent
  #handleAgentConnection(ws: WebSocket, sandboxName: string, gatewayName?: string): void {
    let detach: (() => void) | undefined;
    let closed = false;
    ws.on('close', () => {
      closed = true;
      detach?.();
    });

    // onError carries the agent's stderr stream, not a failure: the terminal shows it like stdout
    const forward = (content: string): void => {
      if (ws.readyState === ws.OPEN) ws.send(Buffer.from(content));
    };
    this.#serveTerminal(ws, 'agent session', async start => {
      let terminal: Awaited<ReturnType<AgentWorkspaceManager['attachAgentTerminal']>>;
      try {
        const match = await this.#findWorkspace(sandboxName, gatewayName);
        if (typeof match === 'string') {
          this.#sendLookupFailure(ws, match);
          return undefined;
        }
        // the client left during the lookup: do not start an agent session for nobody
        if (closed) return undefined;
        terminal = await this.agentWorkspaceManager.attachAgentTerminal(sandboxName, match.gateway, {
          onData: forward,
          onError: forward,
          onEnd: () => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'exit', exitCode: 0 }));
              ws.close();
            }
          },
        });
      } catch (err: unknown) {
        // the client left while attaching: a normal end, not a failure
        if (closed) {
          console.debug(
            `API server: client left while opening agent session on "${sandboxName}" (gateway ${gatewayName ?? 'any'})`,
            err,
          );
          return undefined;
        }
        throw err;
      }
      detach = terminal.detach;
      if (closed) {
        detach();
        return undefined;
      }
      if (start.cols !== undefined && start.rows !== undefined) {
        terminal.resize(
          this.#dimension(start.cols, ApiServer.DEFAULT_COLS),
          this.#dimension(start.rows, ApiServer.DEFAULT_ROWS),
        );
      }
      // streaming decoder keeps multibyte characters split across frames intact
      const decoder = new TextDecoder();
      return {
        write: (data): void => terminal.write(decoder.decode(data, { stream: true })),
        resize: (cols, rows): void => terminal.resize(cols, rows),
      };
    });
  }

  async #removePortFile(): Promise<void> {
    const portFilePath = this.#portFilePath;
    this.#portFilePath = undefined;
    if (!portFilePath) return;
    try {
      // another instance may have replaced the file since: only remove our own
      if ((await readFile(portFilePath, 'utf-8')).includes(this.#token)) {
        await unlink(portFilePath);
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
        console.error('API server: failed to remove port file', err);
      }
    }
  }

  @preDestroy()
  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#configurationListener?.dispose();
    this.#configurationListener = undefined;
    await this.#enqueue(() => this.#stop());
  }

  async #stop(): Promise<void> {
    await this.#removePortFile();

    // ws 8 no longer closes upgraded clients on wss.close(), and they keep server.close() pending
    for (const client of this.#wss?.clients ?? []) {
      client.terminate();
    }
    this.#wss?.close();
    this.#wss = undefined;

    const server = this.server;
    this.server = undefined;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    }
  }
}
