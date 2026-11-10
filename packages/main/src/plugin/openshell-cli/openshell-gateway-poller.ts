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
import { inject, injectable } from 'inversify';

import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

export interface GatewayPollOptions<T> {
  /** What is polled (e.g. `sandboxes`), used in log messages. */
  label: string;
  /** Lists the resources of one reachable gateway. */
  list(gateway: GatewayInfo): Promise<T>;
  /** Serializes a listing; two listings with the same serialization are considered unchanged. */
  serialize(value: T): string;
  /** Called after a poll tick when the listing of any gateway changed. */
  onChange(): void;
}

interface GatewayPollState {
  // last listing seen per gateway
  snapshots: Map<string, string>;
  // gateways whose last listing failed, so the failure is logged once until it recovers
  failures: Set<string>;
  inFlight: boolean;
  // set when the watch is disposed, so a listing that resolves afterwards does not call onChange
  disposed: boolean;
}

/**
 * Lists a resource on every reachable gateway at each gateway poll tick and reports when it changed.
 */
@injectable()
export class OpenshellGatewayPoller {
  // The SDK list calls take no timeout, so a hung gateway would otherwise block every later poll.
  private readonly pollTimeoutMs = 10_000;

  constructor(
    @inject(OpenshellGatewayStateManager)
    private readonly gatewayStateManager: OpenshellGatewayStateManager,
  ) {}

  /**
   * Lists the resource on each gateway poll tick and calls `onChange` when it changed.
   * Disposing the returned `Disposable` stops the watch.
   */
  watch<T>(options: GatewayPollOptions<T>): Disposable {
    const state: GatewayPollState = { snapshots: new Map(), failures: new Set(), inFlight: false, disposed: false };
    const subscription = this.gatewayStateManager.onDidPoll(gateways => {
      this.poll(options, state, gateways).catch((err: unknown) => {
        console.warn(`[OpenshellGatewayPoller] unable to poll ${options.label}:`, err);
      });
    });
    return {
      dispose: (): void => {
        state.disposed = true;
        subscription.dispose();
      },
    };
  }

  // Listing is read-only, so a late response after the timeout is simply dropped.
  private async listWithTimeout<T>(options: GatewayPollOptions<T>, gateway: GatewayInfo): Promise<T> {
    const timedOut = Promise.withResolvers<never>();
    const timer = setTimeout(
      () =>
        timedOut.reject(
          new Error(`listing ${options.label} of gateway ${gateway.name} timed out after ${this.pollTimeoutMs}ms`),
        ),
      this.pollTimeoutMs,
    );
    try {
      return await Promise.race([options.list(gateway), timedOut.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Lists reachable gateways only (in parallel), so polling stops while a gateway is unhealthy.
  // A failed listing keeps the previous snapshot of that gateway instead of reporting it empty.
  private async poll<T>(
    options: GatewayPollOptions<T>,
    state: GatewayPollState,
    gateways: readonly GatewayInfo[],
  ): Promise<void> {
    if (state.inFlight) {
      return;
    }
    state.inFlight = true;
    try {
      const snapshots = new Map<string, string>();
      const reachable = gateways.filter(gw => gw.gatewayState?.reachable);
      await Promise.all(
        reachable.map(async gateway => {
          try {
            snapshots.set(gateway.name, options.serialize(await this.listWithTimeout(options, gateway)));
            state.failures.delete(gateway.name);
          } catch (err: unknown) {
            if (!state.failures.has(gateway.name)) {
              state.failures.add(gateway.name);
              console.warn(`[OpenshellGatewayPoller] unable to poll ${options.label} of gateway ${gateway.name}:`, err);
            }
            const previous = state.snapshots.get(gateway.name);
            if (previous !== undefined) {
              snapshots.set(gateway.name, previous);
            }
          }
        }),
      );
      for (const name of state.failures) {
        if (!reachable.some(gw => gw.name === name)) {
          state.failures.delete(name);
        }
      }
      const changed =
        snapshots.size !== state.snapshots.size ||
        [...snapshots].some(([name, snapshot]) => state.snapshots.get(name) !== snapshot);
      state.snapshots = snapshots;
      if (changed && !state.disposed) {
        options.onChange();
      }
    } finally {
      state.inFlight = false;
    }
  }
}
