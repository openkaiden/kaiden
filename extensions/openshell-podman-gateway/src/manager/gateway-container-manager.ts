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

import { randomInt } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { Disposable, ExtensionContext } from '@openkaiden/api';
import * as extensionApi from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
import type Dockerode from 'dockerode';
import { inject, injectable } from 'inversify';
import * as tar from 'tar';

import { SocketHelper } from '/@/helper/socket-helper';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol } from '/@/inject/symbol';

export const GATEWAY_IMAGE = 'ghcr.io/nvidia/openshell/gateway:0.0.71';
const GATEWAY_LABEL = 'ai.openkaiden.openshell-podman-gateway';
const GATEWAY_PORT_LABEL = 'ai.openkaiden.openshell-podman-gateway.port';
const GATEWAY_NAME = 'kaiden';
const LOG_PREFIX = '[openshell-podman-gateway]';

const GATEWAY_CONFIG = `[openshell]
version = 1

[openshell.gateway.auth]
allow_unauthenticated_users = true

[openshell.gateway.gateway_jwt]
signing_key_path = "/kaiden/jwt/signing.pem"
public_key_path = "/kaiden/jwt/public.pem"
kid_path = "/kaiden/jwt/kid"
ttl_secs = 0
`;

@injectable()
export class GatewayContainerManager implements Disposable {
  @inject(ContainerExtensionAPISymbol)
  private containerExtensionAPI!: ContainerExtensionAPI;

  @inject(ExtensionContextSymbol)
  private extensionContext!: ExtensionContext;

  @inject(SocketHelper)
  private socketHelper!: SocketHelper;

  #port: number | undefined;
  #disposed = false;

  async init(): Promise<void> {
    if (!extensionApi.env.isWindows) {
      console.log(`${LOG_PREFIX} not on Windows, skipping`);
      return;
    }

    await this.trySetupGateway();

    this.containerExtensionAPI.onEndpointsChanged(() => {
      this.trySetupGateway().catch((err: unknown) => {
        console.error(`${LOG_PREFIX} failed to setup gateway on endpoint change:`, err);
      });
    });

    extensionApi.cli.onDidChange(() => {
      this.trySetupGateway().catch((err: unknown) => {
        console.error(`${LOG_PREFIX} failed to setup gateway on CLI change:`, err);
      });
    });
  }

  async trySetupGateway(): Promise<void> {
    if (this.#disposed || this.#port !== undefined) {
      return;
    }

    const endpoints = this.containerExtensionAPI.getEndpoints();
    if (endpoints.length === 0) {
      console.log(`${LOG_PREFIX} no container endpoints available yet`);
      return;
    }

    const cliPath = this.findOpenshellCliPath();
    if (!cliPath) {
      console.log(`${LOG_PREFIX} openshell CLI not available yet`);
      return;
    }

    try {
      const existing = await this.findExistingGatewayContainer(endpoints);
      if (existing) {
        if (existing.state !== 'running') {
          console.log(`${LOG_PREFIX} starting existing gateway container ${existing.containerId}`);
          const container = existing.dockerode.getContainer(existing.containerId);
          await container.start();
        } else {
          console.log(
            `${LOG_PREFIX} gateway container ${existing.containerId} is already running on port ${existing.port}`,
          );
        }
        this.#port = existing.port;
        await this.doRegisterGateway(cliPath, existing.port);
        return;
      }

      console.log(`${LOG_PREFIX} no existing gateway container found, creating one`);
      const port = await this.createGatewayContainer(endpoints[0]!.dockerode);
      this.#port = port;
      await this.doRegisterGateway(cliPath, port);
    } catch (err: unknown) {
      console.error(`${LOG_PREFIX} failed to ensure gateway container:`, err);
    }
  }

  private async findExistingGatewayContainer(
    endpoints: readonly EndpointConnection[],
  ): Promise<{ dockerode: Dockerode; containerId: string; state: string; port: number } | undefined> {
    for (const endpoint of endpoints) {
      const containers = await endpoint.dockerode.listContainers({ all: true });
      const existing = containers.find(c => c.Labels?.[GATEWAY_LABEL]);

      if (existing) {
        const portStr = existing.Labels?.[GATEWAY_PORT_LABEL];
        const port = portStr ? parseInt(portStr, 10) : undefined;

        if (!port || isNaN(port)) {
          console.error(`${LOG_PREFIX} found gateway container but port label is missing or invalid`);
          return undefined;
        }

        return { dockerode: endpoint.dockerode, containerId: existing.Id, state: existing.State, port };
      }
    }
    return undefined;
  }

  private async createGatewayContainer(dockerode: Dockerode): Promise<number> {
    await this.pullImage(dockerode);

    const gatewayDir = join(this.extensionContext.storagePath, 'gateway');

    await this.generateCerts(dockerode, gatewayDir);
    await this.writeGatewayConfig(gatewayDir);

    const port = randomInt(1024, 65536);

    const container = await dockerode.createContainer({
      Image: GATEWAY_IMAGE,
      Cmd: [
        '--port',
        String(port),
        '--disable-tls',
        '--drivers',
        'podman',
        '--bind-address',
        '0.0.0.0',
        '--log-level',
        'trace',
        '--config',
        '/kaiden/gateway.toml',
      ],
      Labels: {
        [GATEWAY_LABEL]: 'true',
        [GATEWAY_PORT_LABEL]: String(port),
      },
      HostConfig: {
        SecurityOpt: ['label=disable'],
        PortBindings: {
          [`${port}/tcp`]: [{ HostPort: String(port) }],
        },
        Mounts: [
          {
            Source: await this.socketHelper.getSocketPath(dockerode),
            Type: 'bind',
            Target: '/run/user/0/podman/podman.sock',
          },
          {
            Source: gatewayDir,
            Type: 'bind',
            Target: '/kaiden',
          },
          {
            Source: '/root/.local/state',
            Type: 'bind',
            Target: '/root/.local/state',
          },
        ],
      },
      User: '0',
    });

    await container.start();
    console.log(`${LOG_PREFIX} gateway container created and started on port ${port}`);

    return port;
  }

  private async generateCerts(dockerode: Dockerode, gatewayDir: string): Promise<void> {
    console.log(`${LOG_PREFIX} generating certificates`);

    const certContainer = await dockerode.createContainer({
      Image: GATEWAY_IMAGE,
      Cmd: [
        'generate-certs',
        '--server-san',
        '127.0.0.1',
        '--server-san',
        'localhost',
        '--server-san',
        'host.openshell.internal',
        '--output-dir',
        '/kaiden',
      ],
      User: '0',
    });

    await certContainer.start();
    await certContainer.wait();

    await rm(gatewayDir, { recursive: true, force: true });
    await mkdir(gatewayDir, { recursive: true });

    const archiveStream = await certContainer.getArchive({ path: '/kaiden' });
    await pipeline(archiveStream, tar.extract({ cwd: gatewayDir, strip: 1 }));

    await certContainer.remove();
    console.log(`${LOG_PREFIX} certificates generated and copied to ${gatewayDir}`);
  }

  private async writeGatewayConfig(gatewayDir: string): Promise<void> {
    const configPath = join(gatewayDir, 'gateway.toml');
    await writeFile(configPath, GATEWAY_CONFIG);
    console.log(`${LOG_PREFIX} gateway config written to ${configPath}`);
  }

  private async checkImageExists(dockerode: Dockerode): Promise<boolean> {
    try {
      await dockerode.getImage(GATEWAY_IMAGE).inspect();
      return true;
    } catch {
      return false;
    }
  }

  private async pullImage(dockerode: Dockerode): Promise<void> {
    const imageExists = await this.checkImageExists(dockerode);
    if (imageExists) {
      console.log(`${LOG_PREFIX} image ${GATEWAY_IMAGE} already available locally, skipping pull`);
      return;
    }

    console.log(`${LOG_PREFIX} pulling image ${GATEWAY_IMAGE}`);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    try {
      const stream = await dockerode.pull(GATEWAY_IMAGE);
      dockerode.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        () => {},
      );
    } catch (err: unknown) {
      reject(err);
    }
    return promise;
  }

  private async doRegisterGateway(cliPath: string, port: number): Promise<void> {
    try {
      await extensionApi.process.exec(cliPath, ['gateway', 'remove', GATEWAY_NAME]);
    } catch {
      // gateway may not exist yet
    }

    try {
      await extensionApi.process.exec(cliPath, [
        'gateway',
        'add',
        `http://localhost:${port}`,
        '--name',
        GATEWAY_NAME,
        '--local',
      ]);
      console.log(`${LOG_PREFIX} registered gateway '${GATEWAY_NAME}' at http://localhost:${port}`);
    } catch (err: unknown) {
      console.error(`${LOG_PREFIX} failed to register gateway:`, err);
    }
  }

  private findOpenshellCliPath(): string | undefined {
    console.log(extensionApi.cli.all);
    const tool = extensionApi.cli.all.find(t => t.name === 'openshell');
    console.log('tool', tool);
    return tool?.path;
  }

  dispose(): void {
    this.#disposed = true;
  }
}
