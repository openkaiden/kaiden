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

import { networkInterfaces } from 'node:os';

import { env } from '@openkaiden/api';
import { injectable } from 'inversify';

/**
 * Resolves the host name that agent containers use to reach the AI Lab daemon.
 */
@injectable()
export class ContainerHostResolver {
  // WSL2: host.containers.internal doesn't reach Windows loopback.
  // Use the first non-internal address (the WSL2 gateway-facing NIC).
  // Requires the AI Lab daemon to be bound to a non-loopback interface.
  getReachableHost(): string {
    if (env.isWindows) {
      for (const entries of Object.values(networkInterfaces())) {
        for (const entry of entries ?? []) {
          if (!entry.internal) {
            return entry.family === 'IPv6' ? `[${entry.address}]` : entry.address;
          }
        }
      }
    }
    return 'localhost';
  }
}
