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

import { setTimeout } from 'node:timers/promises';

import { injectable } from 'inversify';

export interface WaitForHttpOkOptions {
  /** Maximum time to wait, in milliseconds. */
  timeout: number;
  /** Delay between two requests, in milliseconds. */
  interval: number;
  /** Called with each non-2xx response, for example to report progress. Default: none. */
  onNotReady?: (response: Response) => Promise<void>;
}

@injectable()
export class NetworkHelper {
  /**
   * Polls `url` until it answers with a 2xx status. Non-2xx responses and connection errors mean "not ready yet".
   * @throws Error when no 2xx response is received within `timeout`; the last connection error is its cause
   */
  async waitForHttpOk(url: string, options: WaitForHttpOkOptions): Promise<void> {
    const deadline = this.now() + options.timeout;
    let lastError: unknown;
    for (;;) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          return;
        }
        lastError = undefined;
        await options.onNotReady?.(response);
      } catch (err: unknown) {
        // the server is not listening yet: keep the error for the timeout message
        lastError = err;
      }
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        throw new Error(`Timed out after ${options.timeout} ms waiting for ${url}`, { cause: lastError });
      }
      await this.sleep(Math.min(options.interval, remaining));
    }
  }

  // clock and delay of the polling loop, overridden in tests
  protected now(): number {
    return Date.now();
  }

  protected async sleep(ms: number): Promise<void> {
    await setTimeout(ms);
  }

  /**
   * Converts a host as seen from the user's machine into a host reachable from inside a container:
   * maps `localhost/127.0.0.1` to `host.docker.internal`.
   */
  convertHost(hostname: string): string {
    return hostname === 'localhost' || hostname === '127.0.0.1' ? 'host.docker.internal' : hostname;
  }
}
