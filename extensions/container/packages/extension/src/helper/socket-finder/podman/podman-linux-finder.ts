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

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { injectable, preDestroy } from 'inversify';

import type { SocketFinder } from '/@/api/socket-finder';

@injectable()
export class PodmanSocketLinuxFinder implements SocketFinder {
  static readonly SOCKET_WAIT_ATTEMPTS = 50;
  static readonly SOCKET_WAIT_INTERVAL_MS = 100;

  #podmanProcess: ChildProcess | undefined;

  async findPaths(): Promise<string[]> {
    const paths: string[] = [];

    // Rootless socket via XDG_RUNTIME_DIR (e.g. /run/user/1000/podman/podman.sock)
    // Falls back to /run/user/$UID for headless/SSH/non-systemd environments
    const uid = process.getuid?.();
    const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
    if (xdgRuntimeDir) {
      const rootlessSocket = resolve(xdgRuntimeDir, 'podman/podman.sock');
      if (!existsSync(rootlessSocket)) {
        await this.startPodmanService(rootlessSocket);
      }
      if (existsSync(rootlessSocket)) {
        paths.push(rootlessSocket);
      }
    }

    // Rootful socket
    const rootfulSocket = '/run/podman/podman.sock';
    if (existsSync(rootfulSocket)) {
      paths.push(rootfulSocket);
    }

    return paths;
  }

  protected async startPodmanService(socketPath: string): Promise<void> {
    if (this.#podmanProcess) {
      return;
    }

    let command = 'podman';
    let args = ['system', 'service', '--time=0'];
    if (process.env.FLATPAK_ID) {
      command = 'flatpak-spawn';
      args = ['--host', 'podman', ...args];
    }

    this.#podmanProcess = spawn(command, args, { stdio: 'ignore' });
    this.#podmanProcess.on('error', err => {
      console.error('Failed to start podman system service:', err);
      this.#podmanProcess = undefined;
    });

    for (let i = 0; i < PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS; i++) {
      if (existsSync(socketPath)) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS));
    }

    console.error(
      `Could not find the socket at ${socketPath} after ${(PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS) / 1000}s. The command podman system service --time=0 did not work to start the podman socket.`,
    );
  }

  @preDestroy()
  dispose(): void {
    if (this.#podmanProcess) {
      this.#podmanProcess.kill();
      this.#podmanProcess = undefined;
    }
  }
}
