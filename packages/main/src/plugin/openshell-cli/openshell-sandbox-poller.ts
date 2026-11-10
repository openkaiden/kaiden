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

import type { Disposable } from '@openkaiden/api';
import { inject, injectable, preDestroy } from 'inversify';

import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IDisposable } from '/@api/disposable.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

const SANDBOX_POLL_INTERVAL_MS = 5_000;

/**
 * Polls sandbox state while at least one gateway is reachable. When all
 * gateways become unreachable, polling stops and a final update is emitted
 * so the renderer reflects the new state.
 *
 * This restores the polling behavior that was present in the CLI-based
 * implementation and was lost during the switch to the TypeScript SDK.
 */
@injectable()
export class OpenshellSandboxPoller implements Disposable {
  #reachable = new Set<string>();
  #pollInterval: NodeJS.Timeout | undefined;
  #disposables: IDisposable[] = [];

  constructor(
    @inject(OpenshellGatewayStateManager)
    private readonly gatewayStateManager: OpenshellGatewayStateManager,
    @inject(ApiSenderType)
    private readonly apiSender: ApiSenderType,
  ) {}

  init(): void {
    this.#disposables.push(this.gatewayStateManager.onDidUpdateGateways(gateways => this.handleUpdate(gateways)));
    this.handleUpdate(this.gatewayStateManager.listGateways());
  }

  private handleUpdate(gateways: readonly GatewayInfo[]): void {
    const nextReachable = new Set<string>();
    for (const gateway of gateways) {
      if (gateway.gatewayState?.reachable) {
        nextReachable.add(gateway.name);
      }
    }

    const wasPolling = this.#reachable.size > 0;
    const shouldPoll = nextReachable.size > 0;
    this.#reachable = nextReachable;

    if (shouldPoll && !wasPolling) {
      this.startPolling();
    } else if (!shouldPoll && wasPolling) {
      this.stopPolling();
      // One final event so the renderer clears stale sandbox data.
      this.apiSender.send('agent-workspace-update');
    }
  }

  private startPolling(): void {
    if (this.#pollInterval) {
      return;
    }
    this.#pollInterval = setInterval(() => {
      this.apiSender.send('agent-workspace-update');
    }, SANDBOX_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = undefined;
    }
  }

  @preDestroy()
  dispose(): void {
    this.stopPolling();
    for (const disposable of this.#disposables) disposable.dispose();
    this.#disposables = [];
    this.#reachable.clear();
  }
}
