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
import { inject, injectable, postConstruct, preDestroy } from 'inversify';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { Directories } from '/@/plugin/directories.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import type { ApiGateway } from '/@api/api-gateway.js';
import type { ApiSandbox } from '/@api/api-sandbox.js';
import { ApiServerSettings } from '/@api/api-server-settings.js';
import { type IConfigurationNode, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { IDisposable } from '/@api/disposable.js';

@injectable()
export class ApiServer {
  protected static readonly PORT_FILENAME = 'api-port';
  protected static readonly NAME_PATTERN = /^[\w.-]{1,253}$/;

  constructor(
    @inject(Directories) private directories: Directories,
    @inject(AgentWorkspaceManager) private agentWorkspaceManager: AgentWorkspaceManager,
    @inject(IConfigurationRegistry) private configurationRegistry: IConfigurationRegistry,
    @inject(OpenshellGatewayStateManager) private openshellGatewayStateManager: OpenshellGatewayStateManager,
  ) {}

  protected server: Server | undefined;
  #port = 0;
  #portFilePath: string | undefined;
  #disposed = false;
  // clients read it from the port file (owner-only) and send it as a bearer token
  #token = '';
  #configurationListener: IDisposable | undefined;
  // start and stop run one after the other so quick toggles and dispose never interleave
  protected transitions: Promise<void> = Promise.resolve();

  // starts in the background: an optional feature (port file clash, listen error) must not abort startup
  @postConstruct()
  init(): void {
    const enabledKey = `${ApiServerSettings.SectionName}.${ApiServerSettings.Enabled}`;
    const configurationNode: IConfigurationNode = {
      id: 'preferences.api.server',
      title: 'Local API server',
      type: 'object',
      properties: {
        [enabledKey]: {
          description: 'Expose a local API on 127.0.0.1 so local REST clients can list and delete sandboxes.',
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
    this.#applyEnabled().catch((err: unknown) => console.error('API server: failed to start', err));
  }

  #applyEnabled(): Promise<void> {
    const enabled = this.configurationRegistry
      .getConfiguration(ApiServerSettings.SectionName)
      .get<boolean>(ApiServerSettings.Enabled);
    return this.#enqueue(() => (enabled ? this.#start() : this.#stop()));
  }

  #enqueue(transition: () => Promise<void>): Promise<void> {
    const next = this.transitions.then(transition);
    // the caller gets the error through `next`; the queue itself keeps going
    this.transitions = next.catch(() => undefined);
    return next;
  }

  async #start(): Promise<void> {
    if (this.#disposed || this.server) return;
    this.#token = randomBytes(32).toString('hex');

    const expressApp = express();
    expressApp.disable('x-powered-by');
    expressApp.use((req, res, next) => {
      if (this.isAuthorized(req.headers)) {
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });

    // sandboxes are scoped by gateway in the path, like Kubernetes namespaces: the gateway is always required
    expressApp.get('/api/gateways', (_req, res) => {
      // the same snapshot the sandbox routes resolve gateways from
      const gateways: ApiGateway[] = this.openshellGatewayStateManager.listGateways().map(({ name }) => ({ name }));
      res.json(gateways);
    });

    expressApp.get('/api/gateways/:gateway/sandboxes', (req, res) => {
      const gateway = req.params.gateway;
      if (!this.isValidName(gateway)) {
        res.status(400).json({ error: 'Invalid gateway name' });
        return;
      }
      this.#sendSandboxes(res, gateway).catch((err: unknown) =>
        console.error('API server: failed to answer list', err),
      );
    });

    expressApp.delete('/api/gateways/:gateway/sandboxes/:name', (req, res) => {
      const { gateway, name } = req.params;
      if (!this.isValidName(name) || !this.isValidName(gateway)) {
        res.status(400).json({ error: 'Invalid sandbox or gateway name' });
        return;
      }
      this.#sendDelete(res, name, gateway).catch((err: unknown) =>
        console.error('API server: failed to answer delete', err),
      );
    });

    // keep the JSON error contract for unknown routes and errors raised by express itself
    expressApp.use((_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
    expressApp.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error('API server: request failed', err);
      // express flags client errors such as a malformed percent-encoding with status 400
      const badRequest = err instanceof Error && 'status' in err && err.status === 400;
      res.status(badRequest ? 400 : 500).json({ error: badRequest ? 'Bad request' : 'Request failed' });
    });

    const server = createServer(expressApp);

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
    const portFilePath = join(this.portFileDirectory(), ApiServer.PORT_FILENAME);
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

  // the packaged app publishes in the shared data directory; DevApiServer overrides it per checkout
  protected portFileDirectory(): string {
    return this.directories.getDataDirectory();
  }

  // browser requests carry an Origin and DNS-rebound ones a foreign Host: reject both, then require the bearer token
  protected isAuthorized(headers: IncomingHttpHeaders): boolean {
    if (headers.origin !== undefined) return false;
    if (headers.host !== `127.0.0.1:${this.#port}` && headers.host !== `localhost:${this.#port}`) return false;
    const expected = Buffer.from(`Bearer ${this.#token}`);
    const actual = Buffer.from(headers.authorization ?? '');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  protected isValidName(value: unknown): value is string {
    return typeof value === 'string' && ApiServer.NAME_PATTERN.test(value);
  }

  // the manager only lists Kaiden sandboxes and decodes their source path
  protected async listSandboxes(gateway: string): Promise<ApiSandbox[]> {
    const gateways = await this.agentWorkspaceManager.listOpenshellSandboxes(gateway);
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

  // only Kaiden sandboxes are reachable; a gateway that fails to list is skipped (and logged) by the manager,
  // so its sandboxes count as missing. Returns false when the sandbox is not on that gateway
  protected async deleteSandbox(name: string, gateway: string): Promise<boolean> {
    const gateways = await this.agentWorkspaceManager.listOpenshellSandboxes(gateway);
    if (!gateways.some(entry => entry.sandboxes.some(sandbox => sandbox.name === name))) return false;
    // the manager also removes the linked secret, profile, config dir and terminals
    await this.agentWorkspaceManager.deleteOpenshellSandbox(name, gateway);
    return true;
  }

  // express 4 ignores promises returned by handlers: each route answers its own errors
  async #sendSandboxes(res: Response, gateway: string): Promise<void> {
    try {
      res.json(await this.listSandboxes(gateway));
    } catch (err: unknown) {
      console.error('API server error listing sandboxes', err);
      res.status(500).json({ error: 'Failed to list sandboxes' });
    }
  }

  async #sendDelete(res: Response, name: string, gateway: string): Promise<void> {
    try {
      if (await this.deleteSandbox(name, gateway)) {
        res.json({ deleted: true });
      } else {
        res.status(404).json({ error: 'Sandbox not found' });
      }
    } catch (err: unknown) {
      console.error('API server error deleting sandbox', err);
      res.status(500).json({ error: 'Failed to delete sandbox' });
    }
  }

  async #removePortFile(): Promise<void> {
    const portFilePath = this.#portFilePath;
    this.#portFilePath = undefined;
    if (!portFilePath) return;
    try {
      // another instance may have replaced the file since: only remove our own
      if ((await readFile(portFilePath, 'utf-8')).split('\n')[1] === this.#token) {
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
