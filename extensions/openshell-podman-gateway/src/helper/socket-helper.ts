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

// eslint-disable-next-line import/no-extraneous-dependencies
import Dockerode from 'dockerode';
import { injectable } from 'inversify';

import type { Info } from '/@/helper/podman-info';

const UNIX_SOCKET_PREFIX = 'unix://';
// Default user of a Podman machine running rootless
const ROOTLESS_LOCAL_DATA_DIR = '/home/user/.local';
const ROOTFUL_LOCAL_DATA_DIR = '/root/.local';

@injectable()
export class SocketHelper {
  async getInfo(dockerode: Dockerode): Promise<Info> {
    const optsf = {
      path: '/v4.2.0/libpod/info',
      method: 'GET',
      statusCodes: {
        200: true,
        500: 'server error',
      },
      options: {},
    };

    return new Promise((resolve, reject) => {
      dockerode.modem.dial(optsf, (err: unknown, data: unknown) => {
        if (err) {
          return reject(err);
        }
        resolve(data as Info);
      });
    });
  }

  async getSocketPath(dockerode: Dockerode): Promise<string> {
    return this.getSocketPathFromInfo(await this.getInfo(dockerode));
  }

  getSocketPathFromInfo(info: Info): string {
    const path = info.host.remoteSocket.path;
    if (path.startsWith(UNIX_SOCKET_PREFIX)) {
      return path.slice(UNIX_SOCKET_PREFIX.length);
    }
    return path;
  }

  /**
   * The .local folder of the user running the container engine in the Podman machine.
   */
  getLocalDataDir(info: Info): string {
    return info.host.security.rootless ? ROOTLESS_LOCAL_DATA_DIR : ROOTFUL_LOCAL_DATA_DIR;
  }
}
