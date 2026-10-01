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

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConnectOptions } from '@nvidia/openshell-sdk';
import { injectable } from 'inversify';

import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

/**
 * Resolves OpenShell gateway configuration (config paths, mTLS certificates)
 * and builds the `ConnectOptions` needed by the SDK to connect to a gateway.
 */
@injectable()
export class OpenshellGatewayConfig {
  async buildConnectOptions(gateway: Pick<GatewayInfo, 'name' | 'endpoint'>): Promise<ConnectOptions> {
    const isHttps = gateway.endpoint.startsWith('https://');

    if (!isHttps) {
      return { gateway: gateway.endpoint };
    }

    const mtlsDir = this.#gatewayMtlsDir(gateway.name);
    const [caCert, clientCert, clientKey] = await Promise.all([
      this.#readCertIfExists(join(mtlsDir, 'ca.crt')),
      this.#readCertIfExists(join(mtlsDir, 'tls.crt')),
      this.#readCertIfExists(join(mtlsDir, 'tls.key')),
    ]);

    return {
      gateway: gateway.endpoint,
      caCert,
      clientCert,
      clientKey,
    };
  }

  /**
   * Resolve the OpenShell config root following the same logic as the Rust CLI:
   *   1. $XDG_CONFIG_HOME (all platforms, including Windows)
   *   2. %APPDATA% on win32
   *   3. $HOME/.config
   */
  #openshellConfigRoot(): string {
    const xdg = process.env['XDG_CONFIG_HOME'];
    if (xdg) return xdg;

    if (process.platform === 'win32') {
      const appdata = process.env['APPDATA'];
      if (appdata) return appdata;
    }

    return join(homedir(), '.config');
  }

  #gatewayMtlsDir(gatewayName: string): string {
    return join(this.#openshellConfigRoot(), 'openshell', 'gateways', gatewayName, 'mtls');
  }

  async #readCertIfExists(filePath: string): Promise<Buffer | undefined> {
    try {
      return await readFile(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }
}
