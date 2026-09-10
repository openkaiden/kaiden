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

import { derived, type Writable, writable } from 'svelte/store';

import type { GatewaySandboxes, SandboxInfo } from '/@api/openshell-gateway-info';

import { EventStore } from './event-store';

const windowEvents = ['agent-workspace-update'];
const windowListeners = ['extensions-already-started'];

let readyToUpdate = false;

export async function checkForUpdate(eventName: string): Promise<boolean> {
  if ('extensions-already-started' === eventName) {
    readyToUpdate = true;
  }

  // do not fetch until extensions are all started
  return readyToUpdate;
}

export const openshellSandboxes: Writable<GatewaySandboxes[]> = writable([]);

const listOpenshellSandboxes = (): Promise<GatewaySandboxes[]> => {
  return window.listOpenshellSandboxes();
};

export const openshellSandboxesEventStore = new EventStore<GatewaySandboxes[]>(
  'openshell-sandboxes',
  openshellSandboxes,
  checkForUpdate,
  windowEvents,
  windowListeners,
  listOpenshellSandboxes,
);
openshellSandboxesEventStore.setup();

export interface SandboxInfoWithGateway extends SandboxInfo {
  gatewayName: string;
}

// Workaround: the Podman driver's event watcher can briefly report a sandbox as
// Provisioning between Deleting and actual removal (stop event → inspect →
// derive_phase returns Provisioning before the remove event arrives).
// Pin the phase to Deleting once observed until the sandbox disappears.
const deletingSandboxIds = new Set<string>();

// Derived store: flatten all sandboxes across gateways and add gateway name for easier UI consumption
export const allOpenshellSandboxes = derived(openshellSandboxes, $sandboxes => {
  const flattened: SandboxInfoWithGateway[] = [];
  const currentIds = new Set<string>();
  for (const gatewaySandboxes of $sandboxes) {
    for (const sandbox of gatewaySandboxes.sandboxes) {
      currentIds.add(sandbox.id);
      if (sandbox.phase === 'Deleting') {
        deletingSandboxIds.add(sandbox.id);
      } else if (sandbox.phase !== 'Provisioning' && deletingSandboxIds.has(sandbox.id)) {
        deletingSandboxIds.delete(sandbox.id);
      }
      const phase = deletingSandboxIds.has(sandbox.id) ? 'Deleting' : sandbox.phase;
      flattened.push({
        ...sandbox,
        phase,
        gatewayName: gatewaySandboxes.gateway.name,
      });
    }
  }
  for (const id of deletingSandboxIds) {
    if (!currentIds.has(id)) {
      deletingSandboxIds.delete(id);
    }
  }
  return flattened;
});

// Search pattern for filtering sandboxes
export const searchPattern = writable('');

// Gateway filter: empty string means "all gateways"
export const selectedGateway = writable('');

// Derived store: filtered sandboxes based on search pattern and selected gateway
export const filteredOpenshellSandboxes = derived(
  [searchPattern, selectedGateway, allOpenshellSandboxes],
  ([$searchPattern, $selectedGateway, $allSandboxes]) => {
    let result = $allSandboxes;

    if ($selectedGateway) {
      result = result.filter(sandbox => sandbox.gatewayName === $selectedGateway);
    }

    const term = $searchPattern.trim().toLowerCase();
    if (term) {
      result = result.filter(
        sandbox =>
          sandbox.name.toLowerCase().includes(term) ||
          sandbox.id.toLowerCase().includes(term) ||
          sandbox.gatewayName.toLowerCase().includes(term),
      );
    }

    return result;
  },
);
