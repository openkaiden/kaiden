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

import { injectable } from 'inversify';

import type { SocketFinder } from '/@/api/socket-finder';

@injectable()
export class DockerSocketLinuxFinder implements SocketFinder {
  #reported = false;

  async findPaths(): Promise<string[]> {
    const socketPath = '/var/run/docker.sock';

    if (!existsSync(socketPath)) {
      // Discovery polls every 30 seconds; report once until a socket is found again.
      if (!this.#reported) {
        console.warn('No active docker socket found.');
      }
      this.#reported = true;
      return [];
    }
    this.#reported = false;
    return [socketPath];
  }
}
