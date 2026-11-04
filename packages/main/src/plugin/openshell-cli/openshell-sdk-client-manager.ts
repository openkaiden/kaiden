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

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { inject, injectable, preDestroy } from 'inversify';

import { OpenshellGatewayConfig } from '/@/plugin/openshell-cli/openshell-gateway-config.js';
import { OpenshellGatewayManager } from '/@/plugin/openshell-cli/openshell-gateway-manager.js';
import type { GatewayMetadata } from '/@api/openshell-gateway-info.js';

/**
 * Cached factory for OpenShell SDK clients. Resolves gateway metadata from
 * the gateway manager (config folders) and delegates connect-option assembly
 * to {@link OpenshellGatewayConfig}.
 *
 * Clients are lazy — no network request is made until the first RPC.
 */
@injectable()
export class OpenshellSdkClientManager {
  readonly #cache = new Map<string, { endpoint: string; client: Promise<OpenShellClient> }>();

  constructor(
    @inject(OpenshellGatewayManager)
    private readonly gatewayManager: OpenshellGatewayManager,
    @inject(OpenshellGatewayConfig)
    private readonly gatewayConfig: OpenshellGatewayConfig,
  ) {}

  async getClient(gatewayName: string): Promise<OpenShellClient> {
    const gateway = await this.gatewayManager.getGateway(gatewayName);

    const cached = this.#cache.get(gateway.name);
    if (cached?.endpoint === gateway.gateway_endpoint) {
      return cached.client;
    }

    const connecting = this.#connect(gateway);
    this.#cache.set(gateway.name, { endpoint: gateway.gateway_endpoint, client: connecting });
    try {
      return await connecting;
    } catch (err: unknown) {
      console.error(`[openshell-sdk-client] failed to connect to gateway "${gateway.name}":`, err);
      if (this.#cache.get(gateway.name)?.client === connecting) {
        this.#cache.delete(gateway.name);
      }
      throw err;
    }
  }

  invalidate(gatewayName?: string): void {
    if (gatewayName) {
      this.#cache.delete(gatewayName);
    } else {
      this.#cache.clear();
    }
  }

  @preDestroy()
  dispose(): void {
    this.#cache.clear();
  }

  async #connect(gateway: GatewayMetadata): Promise<OpenShellClient> {
    const { OpenShellClient: ClientClass } = await import('@nvidia/openshell-sdk');
    const options = await this.gatewayConfig.buildConnectOptions({
      name: gateway.name,
      endpoint: gateway.gateway_endpoint,
    });
    return ClientClass.connect(options);
  }
}
