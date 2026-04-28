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
import { derived, writable } from 'svelte/store';

import { findMatchInLeaves } from '/@/stores/search-util';
import type { SecretInfo } from '/@api/secret-info';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import { EventStore } from './event-store';

function secretInfoToVaultInfo(info: SecretInfo): SecretVaultInfo {
  return {
    id: info.name,
    name: info.name,
    type: info.type,
    description: info.description,
  };
}

export const secretVaultInfos: Writable<readonly SecretVaultInfo[]> = writable([]);

export const secretVaultSearchPattern = writable('');

export const filteredSecretVaultInfos = derived(
  [secretVaultInfos, secretVaultSearchPattern],
  ([$secretVaultInfos, $secretVaultSearchPattern]) => {
    const pattern = $secretVaultSearchPattern.trim();
    if (pattern.length) {
      return $secretVaultInfos.filter(secret => findMatchInLeaves(secret, pattern));
    }

    return $secretVaultInfos;
  },
);

let readyToUpdate = false;

async function checkForUpdate(eventName: string): Promise<boolean> {
  if ('system-ready' === eventName) {
    readyToUpdate = true;
  }
  return readyToUpdate;
}

const listSecrets = async (): Promise<readonly SecretVaultInfo[]> => {
  const items = await window.listSecrets();
  return items.map(secretInfoToVaultInfo);
};

export const secretVaultEventStore = new EventStore<readonly SecretVaultInfo[]>(
  'secret-vault',
  secretVaultInfos,
  checkForUpdate,
  ['secret-manager-update'],
  ['system-ready'],
  listSecrets,
);
secretVaultEventStore.setup();
