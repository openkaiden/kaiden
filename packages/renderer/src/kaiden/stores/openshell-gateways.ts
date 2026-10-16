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

import { get, type Writable, writable } from 'svelte/store';

import { EventStore } from '/@/stores/event-store';
import type { GatewayInfo } from '/@api/openshell-gateway-info';

const windowEvents = ['agent-gateway-update', 'openshell-registry:gateway-update'];
const windowListeners = ['extensions-already-started'];

let readyToUpdate = false;

export async function checkForUpdate(eventName: string): Promise<boolean> {
  if (eventName === 'extensions-already-started') {
    readyToUpdate = true;
  }

  return readyToUpdate;
}

export const openshellGateways: Writable<GatewayInfo[]> = writable([]);
export const openshellGatewaysReady: Writable<boolean> = writable(false);

const listOpenshellGateways = async (): Promise<GatewayInfo[]> => {
  const gateways = await window.listOpenshellGateways();
  if (!get(openshellGatewaysReady)) {
    openshellGatewaysReady.set(true);
  }
  return gateways;
};

export const openshellGatewaysEventStore = new EventStore<GatewayInfo[]>(
  'openshell-gateways',
  openshellGateways,
  checkForUpdate,
  windowEvents,
  windowListeners,
  listOpenshellGateways,
);
openshellGatewaysEventStore.setup();
