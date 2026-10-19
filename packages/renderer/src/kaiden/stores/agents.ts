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

import { type Writable, writable } from 'svelte/store';

import { EventStore } from '/@/stores/event-store';
import type { AgentInfo } from '/@api/agent-info';

const windowEvents: string[] = [
  'extensions-started',
  'agent-registry:create',
  'agent-registry:remove',
  'agent-registry:updated',
];
const windowListeners = ['system-ready', 'extensions-already-started'];

export async function checkForUpdate(): Promise<boolean> {
  return true;
}

export const agentInfos: Writable<AgentInfo[]> = writable([]);

const eventStore = new EventStore<AgentInfo[]>(
  'agents',
  agentInfos,
  checkForUpdate,
  windowEvents,
  windowListeners,
  window.getAgentInfos,
);
eventStore.setup();
