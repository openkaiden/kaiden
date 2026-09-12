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
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { Disposable } from '@openkaiden/api';
import { inject, injectable, preDestroy } from 'inversify';

import { Directories } from '/@/plugin/directories.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { IDisposable } from '/@api/disposable.js';
import type { Event } from '/@api/event.js';
import { GATEWAY_NAME_PATTERN, type GatewayInfo, KAIDEN_LOCAL_GATEWAY_NAME, type LocalGatewayDriver } from '/@api/openshell-gateway-info.js';

import { OpenshellCli } from './openshell-cli.js';

const OPENSHELL_CONFIGURATION_SECTION = 'openshell';
const GATEWAY_POLL_INTERVAL_CONFIGURATION = 'gateway.pollInterval';
const GATEWAY_POLL_INTERVAL_CONFIGURATION_KEY = `${OPENSHELL_CONFIGURATION_SECTION}.${GATEWAY_POLL_INTERVAL_CONFIGURATION}`;
const DEFAULT_GATEWAY_POLL_INTERVAL_SECONDS = 5;
const MIN_GATEWAY_POLL_INTERVAL_SECONDS = 1;
const MAX_GATEWAY_POLL_INTERVAL_SECONDS = 60 * 60;

@injectable()
export class OpenshellGatewayStateManager implements Disposable {
  #gateways = new Map<string, GatewayInfo>();
  #initialized = false;
  #ready = false;
  #pollInterval: NodeJS.Timeout | undefined;
  #refreshPromise: Promise<void> | undefined;
  #refreshQueued = false;
  #configurationChangeDisposable: IDisposable | undefined;

  readonly #onDidUpdateGateways = new Emitter<readonly GatewayInfo[]>();
  readonly onDidUpdateGateways: Event<readonly GatewayInfo[]> = this.#onDidUpdateGateways.event;

  constructor(
    @inject(OpenshellCli)
    private readonly openshellCli: OpenshellCli,
    @inject(IConfigurationRegistry)
    private readonly configurationRegistry: IConfigurationRegistry,
    @inject(Directories)
    private readonly directories: Directories,
  ) {}

  init(): void {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    this.refresh().catch((err: unknown) => this.logRefreshError(err));
    this.schedulePolling();
    this.#configurationChangeDisposable = this.configurationRegistry.onDidChangeConfiguration(event => {
      if (event.key === GATEWAY_POLL_INTERVAL_CONFIGURATION_KEY) {
        this.schedulePolling();
      }
    });
  }

  private schedulePolling(): void {
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
    }
    const configuredPollIntervalSeconds = this.configurationRegistry
      .getConfiguration(OPENSHELL_CONFIGURATION_SECTION)
      .get<number>(GATEWAY_POLL_INTERVAL_CONFIGURATION, DEFAULT_GATEWAY_POLL_INTERVAL_SECONDS);
    const pollIntervalSeconds = Math.min(
      MAX_GATEWAY_POLL_INTERVAL_SECONDS,
      Math.max(MIN_GATEWAY_POLL_INTERVAL_SECONDS, configuredPollIntervalSeconds),
    );
    this.#pollInterval = setInterval(() => {
      this.refresh().catch((err: unknown) => this.logRefreshError(err));
    }, pollIntervalSeconds * 1000);
  }

  listGateways(): readonly GatewayInfo[] {
    return Array.from(this.#gateways.values());
  }

  /** Waits until the initial gateway snapshot has been populated. */
  whenReady(): Promise<void> {
    if (this.#ready) {
      return Promise.resolve();
    }
    return this.#refreshPromise ?? this.refresh();
  }

  refresh(): Promise<void> {
    if (this.#refreshPromise) {
      this.#refreshQueued = true;
      return this.#refreshPromise;
    }
    this.#refreshPromise = this.runRefreshes().finally(() => {
      this.#refreshPromise = undefined;
    });
    return this.#refreshPromise;
  }

  private async runRefreshes(): Promise<void> {
    let lastError: unknown;
    let failed = false;
    do {
      this.#refreshQueued = false;
      try {
        await this.doRefresh();
        this.#ready = true;
        failed = false;
      } catch (err: unknown) {
        lastError = err;
        failed = true;
      }
    } while (this.#refreshQueued);
    if (failed) {
      throw lastError;
    }
  }

  private isKaidenManagedGateway(name: string): boolean {
    if (name === KAIDEN_LOCAL_GATEWAY_NAME) {
      return true;
    }
    return (
      GATEWAY_NAME_PATTERN.test(name) &&
      existsSync(join(this.directories.getDataDirectory(), 'openshell-gateways', name, 'gateway.toml'))
    );
  }

  private async doRefresh(): Promise<void> {
    const registrations = await this.openshellCli.listGateways();
    const gateways = await Promise.all(
      registrations.map(async gateway => {
        const managed = this.isKaidenManagedGateway(gateway.name);
        try {
          const runtimeInfo = await this.openshellCli.getGatewayInfo(gateway.name);
          const reportedDriver = runtimeInfo.compute_drivers[0]?.capabilities.driver_name;
          const driver: LocalGatewayDriver | undefined =
            reportedDriver === 'vm' || reportedDriver === 'podman' || reportedDriver === 'docker'
              ? reportedDriver
              : undefined;
          return {
            ...gateway,
            ...(driver ? { driver } : {}),
            ...(managed ? { source: 'kaiden' } : {}),
            gatewayState: {
              reachable: true,
              health: runtimeInfo.status,
            },
          };
        } catch {
          return {
            ...gateway,
            ...(managed ? { source: 'kaiden' } : {}),
            gatewayState: {
              reachable: false,
              health: 'unknown' as const,
            },
          };
        }
      }),
    );
    const nextGateways = new Map(gateways.map(gateway => [gateway.name, gateway]));
    if (this.hasChanged(nextGateways)) {
      this.#gateways = nextGateways;
      this.#onDidUpdateGateways.fire(this.listGateways());
    }
  }

  private hasChanged(nextGateways: ReadonlyMap<string, GatewayInfo>): boolean {
    if (this.#gateways.size !== nextGateways.size) {
      return true;
    }
    for (const [name, gateway] of nextGateways) {
      if (!isDeepStrictEqual(this.#gateways.get(name), gateway)) {
        return true;
      }
    }
    return false;
  }

  private logRefreshError(err: unknown): void {
    console.warn(`[openshell-gateway-state] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  @preDestroy()
  dispose(): void {
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = undefined;
    }
    this.#configurationChangeDisposable?.dispose();
    this.#configurationChangeDisposable = undefined;
    this.#onDidUpdateGateways.dispose();
  }
}
