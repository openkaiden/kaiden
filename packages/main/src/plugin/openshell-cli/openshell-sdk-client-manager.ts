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
  readonly #cache = new Map<string, Promise<OpenShellClient>>();

  constructor(
    @inject(OpenshellGatewayManager)
    private readonly gatewayManager: OpenshellGatewayManager,
    @inject(OpenshellGatewayConfig)
    private readonly gatewayConfig: OpenshellGatewayConfig,
  ) {}

  async getClient(gatewayName?: string): Promise<OpenShellClient> {
    const gateway = await this.#resolveGateway(gatewayName);

    const cached = this.#cache.get(gateway.name);
    if (cached) {
      return cached;
    }

    const connecting = this.#connect(gateway);
    this.#cache.set(gateway.name, connecting);
    try {
      return await connecting;
    } catch (err: unknown) {
      this.#cache.delete(gateway.name);
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

  async #resolveGateway(gatewayName?: string): Promise<GatewayMetadata> {
    if (gatewayName) {
      return this.gatewayManager.getGateway(gatewayName);
    }

    const activeName = await this.gatewayManager.getActiveGateway();
    if (activeName) {
      return this.gatewayManager.getGateway(activeName);
    }

    const all = await this.gatewayManager.listGateways();

    if (all.length === 1) return all[0]!.metadata;

    if (all.length === 0) {
      throw new Error('No OpenShell gateways registered');
    }
    throw new Error('Multiple OpenShell gateways registered but none is active');
  }
}
