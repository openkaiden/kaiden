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

import type { Writable } from 'svelte/store';
import { writable } from 'svelte/store';

import { EventStore } from '/@/stores/event-store';
import type { SemanticRouterInfo } from '/@api/semantic-router-info';

export const semanticRouterInfos: Writable<readonly SemanticRouterInfo[]> = writable([]);

let readyToUpdate = false;

async function checkForUpdate(eventName: string): Promise<boolean> {
  if ('system-ready' === eventName) {
    readyToUpdate = true;
  }
  return readyToUpdate;
}

const listSemanticRouters = (): Promise<readonly SemanticRouterInfo[]> => {
  return window.listSemanticRouters();
};

export const semanticRoutersEventStore = new EventStore<readonly SemanticRouterInfo[]>(
  'semantic-routers',
  semanticRouterInfos,
  checkForUpdate,
  ['semantic-router-update'],
  ['system-ready'],
  listSemanticRouters,
);
semanticRoutersEventStore.setup();
