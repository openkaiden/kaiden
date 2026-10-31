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
import { OpenshellWorkspaceDefaults } from '/@/plugin/openshell-cli/openshell-workspace-defaults.js';
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
const KAIDEN_OWNED_ANNOTATION = 'ai.openkaiden.kaiden.owned-by';
const KAIDEN_OWNED_VALUE = 'kaiden';

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
          canStop: this.openshellGateway.canStopGateway(listed.metadata.name),
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
            gatewayState: {
              reachable: true,
              health: runtimeInfo.status,
              ...(processState ? { process: processState } : {}),
            },
          };
          const previous = this.#gateways.get(gateway.name);
          if (!previous?.gatewayState?.reachable) {
            await this.synchronizeProfiles(gateway.name);
          }
          return gateway;
        } catch {
          const processState: GatewayProcessState | undefined = this.deriveProcessState(pid, false);
          return {
            ...base,
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

  private async synchronizeProfiles(gatewayName: string): Promise<void> {
    try {
      const client = await this.sdkClientManager.getClient(gatewayName);
      const { profiles: gatewayProfiles } = await client.raw.listProviderProfiles({
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
      const internalProfiles = this.registry.getProfiles();
      const ownedProfiles = gatewayProfiles.filter(
        profile => profile.annotations[KAIDEN_OWNED_ANNOTATION] === KAIDEN_OWNED_VALUE,
      );
      const internalById = new Map(internalProfiles.map(profile => [profile.id, profile]));
      const ownedById = new Map(ownedProfiles.map(profile => [profile.id, profile]));
      const profilesToImport = internalProfiles.filter(profile => !ownedById.has(profile.id));
      const profilesToDelete = ownedProfiles.filter(profile => !internalById.has(profile.id));

      if (profilesToImport.length > 0) {
        const response = await client.raw.importProviderProfiles({
          workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
          profiles: profilesToImport.map(profile => {
            const importedProfile: ProviderProfile = {
              ...profile,
              annotations: { ...profile.annotations, [KAIDEN_OWNED_ANNOTATION]: KAIDEN_OWNED_VALUE },
            };
            return create(ProviderProfileImportItemSchema, { profile: importedProfile, source: 'kaiden' });
          }),
        });
        if (!response.imported) {
          throw new Error(`OpenShell rejected provider profile import for gateway '${gatewayName}'`);
        }
      }

      await Promise.all(
        profilesToDelete.map(profile =>
          client.raw.deleteProviderProfile({
            id: profile.id,
            workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
          }),
        ),
      );
    } catch (err: unknown) {
      console.error(`[openshell-gateway-state] failed to synchronize provider profiles on gateway ${gatewayName}`, err);
    }
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
    this.#onDidUpdateGateways.dispose();
  }
}
