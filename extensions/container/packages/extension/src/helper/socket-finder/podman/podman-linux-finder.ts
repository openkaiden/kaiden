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

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { injectable } from 'inversify';

import type { SocketFinder } from '/@/api/socket-finder';

@injectable()
export class PodmanSocketLinuxFinder implements SocketFinder {
  #reported = false;

  async findPaths(): Promise<string[]> {
    const paths: string[] = [];

    // Rootless socket via XDG_RUNTIME_DIR (e.g. /run/user/1000/podman/podman.sock)
    // Falls back to /run/user/$UID for headless/SSH/non-systemd environments
    const uid = process.getuid?.();
    const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR ?? (uid !== undefined ? `/run/user/${uid}` : undefined);
    if (xdgRuntimeDir) {
      const rootlessSocket = resolve(xdgRuntimeDir, 'podman/podman.sock');
      if (existsSync(rootlessSocket)) {
        paths.push(rootlessSocket);
      }
    }

    // Rootful socket
    const rootfulSocket = '/run/podman/podman.sock';
    if (existsSync(rootfulSocket)) {
      paths.push(rootfulSocket);
    }

    // Discovery polls every 30 seconds; report once until a socket is found again.
    if (paths.length === 0 && !this.#reported) {
      console.warn('No active podman socket found. Enable it with "systemctl --user enable --now podman.socket".');
    }
    this.#reported = paths.length === 0;

    return paths;
  }
}
