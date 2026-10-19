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
import type { AcpSessionInfo } from '/@api/acp-session-info';

export const acpSessions: Writable<AcpSessionInfo[]> = writable([]);

let readyToUpdate = false;

export async function checkForUpdate(eventName: string): Promise<boolean> {
  if ('extensions-already-started' === eventName) {
    readyToUpdate = true;
  }
  return readyToUpdate;
}

const listSessions = async (): Promise<AcpSessionInfo[]> => {
  return window.listAcpSessions();
};

export const acpSessionsEventStore = new EventStore<AcpSessionInfo[]>(
  'acp-sessions',
  acpSessions,
  checkForUpdate,
  ['acp-session-update'],
  ['extensions-already-started'],
  listSessions,
);
export const acpSessionsEventStoreInfo = acpSessionsEventStore.setup();
