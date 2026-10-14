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

import type { HostPreset } from '@openkaiden/api';
import { type Writable, writable } from 'svelte/store';

import { EventStore } from './event-store';

const windowEvents = ['host-preset-registry:updated'];
const windowListeners = ['system-ready', 'extensions-already-started'];

let readyToUpdate = false;

async function checkForUpdate(eventName: string): Promise<boolean> {
  if (eventName === 'extensions-already-started') {
    readyToUpdate = true;
  }

  return readyToUpdate;
}

export const hostPresets: Writable<ReadonlyArray<HostPreset>> = writable([]);

export const hostPresetEventStore = new EventStore<ReadonlyArray<HostPreset>>(
  'host presets',
  hostPresets,
  checkForUpdate,
  windowEvents,
  windowListeners,
  () => {
    return window.getHostPresets();
  },
);
hostPresetEventStore.setup();
