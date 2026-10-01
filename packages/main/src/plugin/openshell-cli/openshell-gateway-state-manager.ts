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

import { isDeepStrictEqual } from 'node:util';

import { create } from '@bufbuild/protobuf';
import { ProviderProfileImportItemSchema } from '@nvidia/openshell-sdk/raw';
import type { Disposable, ProviderProfile } from '@openkaiden/api';
import { inject, injectable, preDestroy } from 'inversify';

import { Emitter } from '/@/plugin/events/emitter.js';
import { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { IDisposable } from '/@api/disposable.js';
import type { Event } from '/@api/event.js';
import type { GatewayInfo, GatewayProcessState, LocalGatewayDriver } from '/@api/openshell-gateway-info.js';

import { OpenshellGatewayManager } from './openshell-gateway-manager.js';
import { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

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
  #disposables: IDisposable[] = [];

  readonly #onDidUpdateGateways = new Emitter<readonly GatewayInfo[]>();
  readonly onDidUpdateGateways: Event<readonly GatewayInfo[]> = this.#onDidUpdateGateways.event;

  constructor(
    @inject(OpenshellGatewayManager)
    private readonly gatewayManager: OpenshellGatewayManager,
    @inject(IConfigurationRegistry)
    private readonly configurationRegistry: IConfigurationRegistry,
    @inject(OpenshellGateway)
    private readonly openshellGateway: OpenshellGateway,
    @inject(OpenShellRegistry)
    private readonly registry: OpenShellRegistry,
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
  ) {}

  init(): void {
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;

    this.#disposables.push(
      this.registry.onDidRegisterProfile((profile: ProviderProfile) => {
        for (const gw of this.listGateways()) {
          if (gw.gatewayState?.reachable && !(gw.importedProfiles ?? []).includes(profile.id)) {
            this.importProfiles(gw, [profile])
              .then(importedProfiles => {
                const current = this.#gateways.get(gw.name);
                if (current) {
                  this.#gateways.set(gw.name, {
                    ...current,
                    importedProfiles: [...new Set([...importedProfiles, ...(current.importedProfiles ?? [])])],
                  });
                  this.#onDidUpdateGateways.fire(this.listGateways());
                }
              })
              .catch((err: unknown) => {
                console.warn(
                  `[openshell-gateway-state] failed to sync profile "${profile.id}" to gateway "${gw.name}": ${err instanceof Error ? err.message : String(err)}`,
                );
              });
          }
        }
      }),
    );

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

  private async doRefresh(): Promise<void> {
    const registrations = await this.gatewayManager.listGateways();
    const activeGatewayName = await this.gatewayManager.getActiveGateway();
    const gateways = await Promise.all(
      registrations.map(async listed => {
        const base: GatewayInfo = {
          name: listed.metadata.name,
          endpoint: listed.metadata.gateway_endpoint,
          active: listed.metadata.name === activeGatewayName,
          source: listed.source,
          is_remote: listed.metadata.is_remote,
          remote_host: listed.metadata.remote_host ?? undefined,
          resolved_host: listed.metadata.resolved_host ?? undefined,
        };
        const pid = await this.openshellGateway.getGatewayPid(base).catch(() => undefined);
        try {
          const runtimeInfo = await this.gatewayManager.getGatewayInfo(listed.metadata.name);
          const reportedDriver = runtimeInfo.compute_drivers[0]?.capabilities.driver_name;
          const driver: LocalGatewayDriver | undefined =
            reportedDriver === 'vm' || reportedDriver === 'podman' || reportedDriver === 'docker'
              ? reportedDriver
              : undefined;
          const processState: GatewayProcessState | undefined = this.deriveProcessState(pid, true);
          const gateway: GatewayInfo = {
            ...base,
            ...(driver ? { driver } : {}),
            importedProfiles: this.#gateways.get(listed.metadata.name)?.importedProfiles ?? [],
            gatewayState: {
              reachable: true,
              health: runtimeInfo.status,
              ...(processState ? { process: processState } : {}),
            },
          };
          gateway.importedProfiles = await this.importProfiles(gateway, this.registry.getProfiles()).catch(
            (err: unknown) => {
              console.warn(
                `[openshell-gateway-state] failed to import profiles on gateway "${gateway.name}": ${err instanceof Error ? err.message : String(err)}`,
              );
              return gateway.importedProfiles;
            },
          );
          return gateway;
        } catch {
          const processState: GatewayProcessState | undefined = this.deriveProcessState(pid, false);
          return {
            ...base,
            importedProfiles: [],
            gatewayState: {
              reachable: false,
              health: 'unknown' as const,
              ...(processState ? { process: processState } : {}),
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

  private async importProfiles(gateway: GatewayInfo, profiles: readonly ProviderProfile[]): Promise<string[]> {
    const imported = new Set(gateway.importedProfiles ?? []);
    const missing = profiles.filter(p => !imported.has(p.id));

    if (missing.length === 0) {
      return Array.from(imported);
    }

    const client = await this.sdkClientManager.getClient(gateway.name);
    const { profiles: existingProfiles } = await client.raw.listProviderProfiles({ workspace: 'default' });
    const existingIds = new Set(existingProfiles.map(p => p.id));

    const toImport = missing.filter(p => !existingIds.has(p.id));
    if (toImport.length > 0) {
      const importItems = toImport.map(profile =>
        create(ProviderProfileImportItemSchema, { profile, source: 'kaiden' }),
      );
      const response = await client.raw.importProviderProfiles({ profiles: importItems, workspace: 'default' });
      if (!response.imported) {
        throw new Error(`Error while importing provider profiles on gateway: ${gateway.name}`);
      }
      for (const d of response.diagnostics) {
        console.warn(`[openshell-gateway-state] import diagnostic for "${d.profileId}": ${d.message}`);
      }
      console.log(`[openshell-gateway-state] synced ${toImport.length} profile(s) to gateway "${gateway.name}"`);
    }

    for (const p of missing) {
      imported.add(p.id);
    }
    return Array.from(imported);
  }

  private deriveProcessState(pid: number | undefined, reachable: boolean): GatewayProcessState | undefined {
    if (pid !== undefined) {
      return { pid, status: 'running' };
    }
    if (!reachable) {
      return { status: 'not-running' };
    }
    return undefined;
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
    for (const d of this.#disposables) {
      d.dispose();
    }
    this.#disposables = [];
    this.#onDidUpdateGateways.dispose();
  }
}
