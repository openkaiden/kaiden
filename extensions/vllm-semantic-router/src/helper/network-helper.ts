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
import { createServer } from 'node:net';
import { type NetworkInterfaceInfoIPv4, networkInterfaces } from 'node:os';

import { injectable } from 'inversify';

export interface RandomPortOptions {
  /**
   * Lowest port that can be returned (inclusive).
   * @default 1024
   */
  min?: number;
  /**
   * Highest port that can be returned (exclusive).
   * @default 65536
   */
  max?: number;
  /**
   * Number of random candidates to try before giving up.
   * @default 50
   */
  maxAttempts?: number;
  /**
   * Ports that must not be returned (e.g. ports already picked but not yet bound).
   * @default no excluded ports
   */
  exclude?: Iterable<number>;
}

@injectable()
export class NetworkHelper {
  async isPortFree(port: number): Promise<boolean> {
    const addresses = ['localhost', '0.0.0.0', ...this.getIPv4Addresses()];
    for (const address of addresses) {
      if (!(await this.isAddressPortFree(address, port))) {
        return false;
      }
    }
    return true;
  }

  async getFreeRandomPort(options?: RandomPortOptions): Promise<number> {
    const min = options?.min ?? 1024;
    const max = options?.max ?? 65536;
    const maxAttempts = options?.maxAttempts ?? 50;
    const exclude = new Set(options?.exclude ?? []);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const port = randomInt(min, max);
      if (!exclude.has(port) && (await this.isPortFree(port))) {
        return port;
      }
    }
    throw new Error(`Unable to find a free port in [${min}, ${max}) after ${maxAttempts} attempts`);
  }

  private isAddressPortFree(address: string, port: number): Promise<boolean> {
    const server = createServer();
    return new Promise((resolve, reject) => {
      server
        .on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            resolve(false);
          } else {
            reject(new Error(`Failed to check port ${port} on ${address}: ${error.message}`));
          }
        })
        .on('listening', () => server.close(() => resolve(true)))
        .listen(port, address);
    });
  }

  private getIPv4Addresses(): string[] {
    return Object.values(networkInterfaces())
      .flat()
      .filter((intf): intf is NetworkInterfaceInfoIPv4 => !!intf && intf.family === 'IPv4' && !!intf.address)
      .map(intf => intf.address);
  }
}
