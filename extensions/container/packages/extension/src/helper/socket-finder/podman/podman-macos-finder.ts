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

import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { process } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import type { SocketFinder } from '/@/api/socket-finder';
import { DockerodeHelper } from '/@/helper/container/dockerode-helper';
import {
  type PodmanMachineListInfo,
  zodPodmanMachineList,
} from '/@/helper/socket-finder/podman/podman-machine-list-info';
import { PodmanVersionDetector } from '/@/helper/socket-finder/podman/podman-version-detector';

interface InspectedSocket {
  path?: string;
  retryAfter: number;
}

@injectable()
export class PodmanSocketMacOSFinder implements SocketFinder {
  static readonly INSPECT_RETRY_DELAY_MS = 5 * 60_000;

  @inject(PodmanVersionDetector)
  private readonly versionDetector: PodmanVersionDetector;

  @inject(DockerodeHelper)
  private readonly dockerodeHelper: DockerodeHelper;

  #machineSocketPaths = new Map<string, InspectedSocket>();

  async findPaths(): Promise<string[]> {
    // socket path is at $HOME/.local/share/containers/podman/machine/podman.sock
    const socketPath = resolve(homedir(), '.local/share/containers/podman/machine/podman.sock');
    if (await this.socketAvailable(socketPath)) {
      this.#machineSocketPaths.clear();
      return [socketPath];
    }

    try {
      const majorVersion = await this.versionDetector.getMajorVersion();
      const args = ['machine', 'ls'];
      if (majorVersion < 6) {
        args.push('--all-providers');
      }
      args.push('--format', 'json');
      const { stdout } = await process.exec('podman', args);

      // use zod to parse the output
      const machines: PodmanMachineListInfo = zodPodmanMachineList.parse(JSON.parse(stdout));

      // filter the machines to keep only the running ones
      const runningMachines = machines.filter(m => m.Running);
      if (runningMachines.length === 0) {
        this.#machineSocketPaths.clear();
        return [];
      }

      const sockets = new Map<string, InspectedSocket>();
      const paths = new Set<string>();
      for (const machine of runningMachines) {
        const machineKey = `${machine.VMType}/${machine.Name}`;
        const socket = this.#machineSocketPaths.get(machineKey) ?? { retryAfter: 0 };
        sockets.set(machineKey, socket);
        try {
          if (socket.path && (await this.socketAvailable(socket.path))) {
            socket.retryAfter = 0;
            paths.add(socket.path);
            continue;
          }
          if (Date.now() < socket.retryAfter) {
            continue;
          }

          // Retry failed/unusable inspections at most every five minutes while the
          // machine stays running. Cached paths are still checked on every poll.
          socket.retryAfter = Date.now() + PodmanSocketMacOSFinder.INSPECT_RETRY_DELAY_MS;

          const { stdout: socketOutput } = await process.exec(
            'podman',
            ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', machine.Name],
            { env: { CONTAINERS_MACHINE_PROVIDER: machine.VMType } },
          );
          const machineSocketPath = socketOutput.trim();
          if (machineSocketPath) {
            socket.path = machineSocketPath;
          }
          if (socket.path && (await this.socketAvailable(socket.path))) {
            socket.retryAfter = 0;
            paths.add(socket.path);
          }
        } catch (error: unknown) {
          console.debug(`PodmanSocketMacOSFinder: unable to inspect podman machine ${machine.Name}`, error);
        }
      }
      // Evict stopped/removed machines; retain paths and failed attempts for running machines.
      this.#machineSocketPaths = sockets;
      return [...paths];
    } catch (error: unknown) {
      this.#machineSocketPaths.clear();
      console.debug('PodmanSocketMacOSFinder: unable to list podman machines', error);
    }

    return [];
  }

  private async socketAvailable(socketPath: string): Promise<boolean> {
    try {
      await access(socketPath);
      await this.dockerodeHelper.getConnection(socketPath);
      return true;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        console.debug(`PodmanSocketMacOSFinder: socket unavailable at ${socketPath}`, error);
      }
      return false;
    }
  }
}
