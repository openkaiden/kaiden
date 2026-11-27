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
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Disposable, ExtensionContext } from '@openkaiden/api';
import * as extensionApi from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
import type Dockerode from 'dockerode';
import { inject, injectable } from 'inversify';

import { AdmissionHookHelper } from '/@/helper/admission-hook-helper';
import { SocketHelper } from '/@/helper/socket-helper';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol } from '/@/inject/symbol';

export const GATEWAY_IMAGE =
  'quay.io/ai-openshell/gateway:0.1.10@sha256:9ee945079d1f9b784d59232ba38e133b9b2797b821dc5cadb4abfccb51902f1d';
const GATEWAY_LABEL = 'ai.openkaiden.openshell-podman-gateway';
const GATEWAY_PORT_LABEL = 'ai.openkaiden.openshell-podman-gateway.port';
const GATEWAY_NAME = 'kaiden-podman';
const LOG_PREFIX = '[openshell-podman-gateway]';

const GATEWAY_CONFIG = `[openshell]
version = 2

[openshell.gateway]
compute_driver = "podman"

[openshell.drivers.podman]
enable_bind_mounts = true
# Since OpenShell 0.1.0: accepts driver config (such as mounts) from the caller's sandbox spec.
allow_driver_config = true
# Since OpenShell 0.1.0: admission rejects resources it cannot label, including host bind mounts.
# Disabling it turns off label-based protection for external resources on this gateway.
resource_admission = { enabled = false }

[openshell.gateway.auth]
allow_unauthenticated_users = true

[openshell.gateway.gateway_jwt]
signing_key_path = "/kaiden/jwt/signing.pem"
public_key_path = "/kaiden/jwt/public.pem"
kid_path = "/kaiden/jwt/kid"
`;

@injectable()
export class GatewayContainerManager implements Disposable {
  private static readonly GATEWAY_HOOK_LABEL = 'ai.openkaiden.openshell-podman-gateway.hook';
  private static readonly GATEWAY_BINARY = '/usr/local/bin/openshell-gateway';
  private static readonly HOOK_MOUNT_DIR = '/kaiden-hook';

  @inject(ContainerExtensionAPISymbol)
  private containerExtensionAPI!: ContainerExtensionAPI;

  @inject(ExtensionContextSymbol)
  private extensionContext!: ExtensionContext;

  @inject(SocketHelper)
  private socketHelper!: SocketHelper;

  @inject(AdmissionHookHelper)
  private admissionHookHelper!: AdmissionHookHelper;

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

    try {
      const existing = await this.findExistingGatewayContainer(endpoints);
      if (existing?.hasHook) {
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
        await this.doRegisterGateway(existing.port);
        return;
      }

      const hookDir = this.admissionHookHelper.getHookDirectory();
      if (!hookDir) {
        throw new Error(`${this.admissionHookHelper.getAdmissionHookBinary()} binary not found, cannot create the gateway container`);
      }

      if (existing) {
        // Containers created before the admission hook was introduced run the gateway directly
        console.log(
          `${LOG_PREFIX} replacing gateway container ${existing.containerId} that does not run the admission hook`,
        );
        await existing.dockerode.getContainer(existing.containerId).remove({ force: true });
      } else {
        console.log(`${LOG_PREFIX} no existing gateway container found, creating one`);
      }
      const port = await this.createGatewayContainer(existing?.dockerode ?? endpoints[0]!.dockerode, hookDir);
      this.#port = port;
      await this.doRegisterGateway(port);
    } catch (err: unknown) {
      console.error(`${LOG_PREFIX} failed to ensure gateway container:`, err);
    }
  }

  private async findExistingGatewayContainer(
    endpoints: readonly EndpointConnection[],
  ): Promise<{ dockerode: Dockerode; containerId: string; state: string; port: number; hasHook: boolean } | undefined> {
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

        return {
          dockerode: endpoint.dockerode,
          containerId: existing.Id,
          state: existing.State,
          port,
          hasHook: existing.Labels?.[GatewayContainerManager.GATEWAY_HOOK_LABEL] === 'true',
        };
      }
    }
    return undefined;
  }

  private async createGatewayContainer(dockerode: Dockerode, hookDir: string): Promise<number> {
    await this.pullImage(dockerode);

    const gatewayDir = join(this.extensionContext.storagePath, 'gateway');

    await this.generateCerts(dockerode, gatewayDir);
    await this.writeGatewayConfig(gatewayDir);

    const port = randomInt(1024, 65536);

    const info = await this.socketHelper.getInfo(dockerode);
    const localDataDir = this.socketHelper.getLocalDataDir(info);
    const systemDriveMountPath = this.getSystemDriveMountPath();

    const container = await dockerode.createContainer({
      Image: GATEWAY_IMAGE,
      // The admission hook is the entrypoint: it serves the hook, registers it in a copy of the gateway config,
      // then launches the gateway command given after '--'
      Entrypoint: [`${GatewayContainerManager.HOOK_MOUNT_DIR}/${this.admissionHookHelper.getAdmissionHookBinary()}`],
      Cmd: [
        'launch',
        '--',
        GatewayContainerManager.GATEWAY_BINARY,
        '--port',
        String(port),
        '--disable-tls',
        '--bind-address',
        '0.0.0.0',
        '--config',
        '/kaiden/gateway.toml',
      ],
      Labels: {
        [GATEWAY_LABEL]: 'true',
        [GATEWAY_PORT_LABEL]: String(port),
        [GatewayContainerManager.GATEWAY_HOOK_LABEL]: 'true',
      },
      ExposedPorts: { [`${port}`]: {} },
      HostConfig: {
        SecurityOpt: ['label=disable'],
        PortBindings: {
          [`${port}/tcp`]: [{ HostPort: String(port) }],
        },
        Mounts: [
          {
            Source: this.socketHelper.getSocketPathFromInfo(info),
            Type: 'bind',
            Target: '/run/user/0/podman/podman.sock',
          },
          {
            Source: gatewayDir,
            Type: 'bind',
            Target: '/kaiden',
          },
          {
            Source: `${localDataDir}/state/openshell`,
            Type: 'bind',
            Target: '/root/.local/state/openshell',
          },
          {
            Source: `${localDataDir}/share/openshell`,
            Type: 'bind',
            Target: '/root/.local/share/openshell',
          },
          {
            Source: systemDriveMountPath,
            Type: 'bind',
            Target: systemDriveMountPath,
          },
          {
            Source: hookDir,
            Type: 'bind',
            Target: GatewayContainerManager.HOOK_MOUNT_DIR,
            ReadOnly: true,
          },
        ],
      },
      User: '0',
      Env: ['LOGDIR=/kaiden', 'NO_COLOR=1'],
    });

    await container.start();
    console.log(`${LOG_PREFIX} gateway container created and started on port ${port}`);

    return port;
  }

  private async generateCerts(dockerode: Dockerode, gatewayDir: string): Promise<void> {
    console.log(`${LOG_PREFIX} generating certificates`);

    // The bind-mount source must exist before the container is created
    await rm(gatewayDir, { recursive: true, force: true });
    await mkdir(gatewayDir, { recursive: true });

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
      HostConfig: {
        SecurityOpt: ['label=disable'],
        Mounts: [
          {
            Source: gatewayDir,
            Type: 'bind',
            Target: '/kaiden',
          },
        ],
      },
    });

    // No AutoRemove: an auto-removed container can disappear before wait() is registered and its exit code is lost.
    // An exited container that still exists returns its exit code right away, so waiting after start is always safe.
    try {
      await certContainer.start();
      const { StatusCode } = await certContainer.wait();
      if (StatusCode !== 0) {
        throw new Error(`certificate generation failed with exit code ${StatusCode}`);
      }
    } finally {
      await certContainer
        .remove({ force: true })
        .catch((err: unknown) => console.error(`${LOG_PREFIX} failed to remove certificate container`, err));
    }
    console.log(`${LOG_PREFIX} certificates generated in ${gatewayDir}`);
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

  private async doRegisterGateway(port: number): Promise<void> {
    const gatewayDir = join(this.getOpenshellGatewaysDir(), GATEWAY_NAME);
    const metadata = {
      name: GATEWAY_NAME,
      gateway_endpoint: `http://localhost:${port}`,
      is_remote: false,
      gateway_port: 0,
      auth_mode: 'plaintext',
    };

    try {
      await mkdir(gatewayDir, { recursive: true });
      await writeFile(join(gatewayDir, 'metadata.json'), JSON.stringify(metadata, undefined, 2), 'utf-8');
      console.log(`${LOG_PREFIX} registered gateway '${GATEWAY_NAME}' at http://localhost:${port}`);
    } catch (err: unknown) {
      console.error(`${LOG_PREFIX} failed to register gateway:`, err);
    }
  }

  /**
   * Path of the Windows system drive inside the Podman machine, derived from %SYSTEMDRIVE% (C: -> /mnt/c).
   */
  getSystemDriveMountPath(): string {
    const match = /^([A-Za-z]):/.exec(process.env['SYSTEMDRIVE'] ?? '');
    const letter = match?.[1].toLowerCase();
    return letter ? `/mnt/${letter}` : '/mnt/c';
  }

  /**
   * Mirrors the openshell CLI user config location: $XDG_CONFIG_HOME, then %APPDATA% (Roaming) on Windows.
   */
  getOpenshellGatewaysDir(): string {
    const configRoot =
      process.env['XDG_CONFIG_HOME'] ?? process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
    return join(configRoot, 'openshell', 'gateways');
  }

  dispose(): void {
    this.#disposed = true;
  }
}
