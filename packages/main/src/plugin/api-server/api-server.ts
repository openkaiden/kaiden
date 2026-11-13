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

import express, { type NextFunction, type Request, type Response } from 'express';
import { inject, injectable, preDestroy } from 'inversify';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { Directories } from '/@/plugin/directories.js';
import { ApiServerSettings } from '/@api/api-server-settings.js';
import type { ApiWorkspace } from '/@api/api-workspace.js';
import { type IConfigurationNode, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { IDisposable } from '/@api/disposable.js';

type LookupFailure = 'not-found' | 'ambiguous';

@injectable()
export class ApiServer {
  protected static readonly PORT_FILENAME = 'api-port';
  protected static readonly NAME_PATTERN = /^[\w.-]{1,253}$/;
  protected static readonly LOOKUP_ERRORS: Record<LookupFailure, string> = {
    'not-found': 'Workspace not found',
    ambiguous: 'Workspace exists on several gateways, pass ?gateway=',
  };

  constructor(
    @inject(Directories) private directories: Directories,
    @inject(AgentWorkspaceManager) private agentWorkspaceManager: AgentWorkspaceManager,
    @inject(IConfigurationRegistry) private configurationRegistry: IConfigurationRegistry,
  ) {}

  protected server: Server | undefined;
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
          description: 'Expose a local API on 127.0.0.1 so local REST clients can list and delete workspaces.',
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

    const server = this.server;
    this.server = undefined;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    }
  }
}
