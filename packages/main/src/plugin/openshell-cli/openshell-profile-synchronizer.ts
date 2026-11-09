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
import { OpenshellProfileOwnership } from '/@/plugin/openshell-cli/openshell-profile-ownership.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { OpenshellWorkspaceDefaults } from '/@/plugin/openshell-cli/openshell-workspace-defaults.js';
import { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import type { IDisposable } from '/@api/disposable.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

/**
 * Pushes Kaiden provider profiles to a gateway the first time it is seen reachable and whenever it
 * transitions from unreachable to reachable, and to every reachable gateway when a profile is
 * registered or unregistered, outside of the gateway state polling path.
 */
@injectable()
export class OpenshellProfileSynchronizer implements Disposable {
  #reachability = new Map<string, boolean>();
  #syncs = new Map<string, Promise<void>>();
  #pending = new Set<string>();
  #disposables: IDisposable[] = [];

  constructor(
    @inject(OpenshellGatewayStateManager)
    private readonly gatewayStateManager: OpenshellGatewayStateManager,
    @inject(OpenShellRegistry)
    private readonly registry: OpenShellRegistry,
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
    @inject(OpenshellProfileOwnership)
    private readonly profileOwnership: OpenshellProfileOwnership,
  ) {}

  init(): void {
    this.#disposables.push(
      this.gatewayStateManager.onDidUpdateGateways(gateways => this.handleUpdate(gateways)),
      this.registry.onDidRegisterProfile(() => this.syncReachableGateways()),
      this.registry.onDidUnregisterProfile(() => this.syncReachableGateways()),
    );
    // The first gateway snapshot is usually not available yet; when it arrives, its reachable gateways are synced.
    this.handleUpdate(this.gatewayStateManager.listGateways());
  }

  // Reads the current gateway state rather than the tracked reachability, which only serves to detect transitions.
  private syncReachableGateways(): void {
    for (const gateway of this.gatewayStateManager.listGateways()) {
      if (gateway.gatewayState?.reachable) {
        this.scheduleSync(gateway.name);
      }
    }
  }

  private handleUpdate(gateways: readonly GatewayInfo[]): void {
    for (const gateway of gateways) {
      // A gateway not known to be reachable (unknown or unreachable) needs a full sync once reachable.
      if (gateway.gatewayState?.reachable && this.#reachability.get(gateway.name) !== true) {
        this.scheduleSync(gateway.name);
      }
    }
    this.#reachability = this.toReachability(gateways);
  }

  private toReachability(gateways: readonly GatewayInfo[]): Map<string, boolean> {
    return new Map(gateways.map(gateway => [gateway.name, gateway.gatewayState?.reachable ?? false]));
  }

  // Chains syncs per gateway so a gateway never runs two synchronizations concurrently. A sync that is
  // queued but not started yet reads the registry when it runs, so further requests are coalesced into it.
  private scheduleSync(gatewayName: string): void {
    if (this.#pending.has(gatewayName)) {
      return;
    }
    this.#pending.add(gatewayName);
    const previous = this.#syncs.get(gatewayName) ?? Promise.resolve();
    this.#syncs.set(gatewayName, this.runSync(gatewayName, previous));
  }

  private async runSync(gatewayName: string, previous: Promise<void>): Promise<void> {
    await previous;
    this.#pending.delete(gatewayName);
    try {
      await this.synchronizeProfiles(gatewayName);
    } catch (err: unknown) {
      console.error(
        `[openshell-profile-synchronizer] failed to synchronize provider profiles on gateway ${gatewayName}`,
        err,
      );
    } finally {
      // Nothing is chained after this sync unless another one is queued.
      if (!this.#pending.has(gatewayName)) {
        this.#syncs.delete(gatewayName);
      }
    }
  }

  private async synchronizeProfiles(gatewayName: string): Promise<void> {
    const client = await this.sdkClientManager.getClient(gatewayName);
    const { profiles: gatewayProfiles } = await client.raw.listProviderProfiles({
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    });
    const internalProfiles = this.registry.getProfiles();
    const ownedProfiles = gatewayProfiles.filter(profile => this.profileOwnership.isOwned(profile));
    const internalIds = new Set(internalProfiles.map(profile => profile.id));
    // Importing an id that already exists on the gateway fails, whether or not Kaiden owns it.
    const gatewayIds = new Set(gatewayProfiles.map(profile => profile.id));
    const profilesToImport = internalProfiles.filter(profile => !gatewayIds.has(profile.id));
    const profilesToDelete = ownedProfiles.filter(profile => !internalIds.has(profile.id));

    if (profilesToImport.length > 0) {
      const response = await client.raw.importProviderProfiles({
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
        profiles: profilesToImport.map(profile => this.profileOwnership.toImportItem(profile)),
      });
      if (!response.imported) {
        throw new Error(
          `OpenShell rejected provider profile import for gateway '${gatewayName}' diagnostics: ${JSON.stringify(response.diagnostics)}`,
        );
      }
    }

    await Promise.all(
      profilesToDelete.map(async profile => {
        try {
          await client.raw.deleteProviderProfile({
            id: profile.id,
            // A profile removed concurrently by the user is not a failure.
            allowMissing: true,
            workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
          });
        } catch (err: unknown) {
          console.error(
            `[openshell-profile-synchronizer] failed to delete provider profile ${profile.id} on gateway ${gatewayName}`,
            err,
          );
        }
      }),
    );
  }

  @preDestroy()
  dispose(): void {
    for (const disposable of this.#disposables) disposable.dispose();
    this.#disposables = [];
    this.#reachability.clear();
    this.#syncs.clear();
    this.#pending.clear();
  }
}
