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
import { derived, get, writable } from 'svelte/store';

import type { SecretVaultInfoUI } from '/@/lib/secret-vault/SecretVaultInfoUI';
import { findMatchInLeaves } from '/@/stores/search-util';
import type { GatewaySecretInfo } from '/@api/secret-info';

import { EventStore } from './event-store';

function secretInfoToVaultInfo(info: GatewaySecretInfo): SecretVaultInfoUI {
  return {
    ...info,
    id: `${info.gateway}/${info.name}`,
  };
}

export const secretVaultInfos: Writable<readonly SecretVaultInfoUI[]> = writable([]);

export const secretVaultSearchPattern = writable('');

// Gateway filter: empty string means "all gateways"
export const selectedGateway = writable('');

export const filteredSecretVaultInfos = derived(
  [secretVaultInfos, secretVaultSearchPattern, selectedGateway],
  ([$secretVaultInfos, $secretVaultSearchPattern, $selectedGateway]) => {
    let result = $secretVaultInfos;

    if ($selectedGateway) {
      result = result.filter(secret => secret.gateway === $selectedGateway);
    }

    const pattern = $secretVaultSearchPattern.trim();
    if (pattern.length) {
      return result.filter(secret => findMatchInLeaves(secret, pattern));
    }

    return result;
  },
);

export function setSecretActionError(id: string, error: string): void {
  secretVaultInfos.update(secrets => secrets.map(s => (s.id === id ? { ...s, actionError: error } : s)));
}

export function clearSecretActionError(id: string): void {
  secretVaultInfos.update(secrets => secrets.map(s => (s.id === id ? { ...s, actionError: undefined } : s)));
}

let readyToUpdate = false;

async function checkForUpdate(eventName: string): Promise<boolean> {
  if ('extensions-already-started' === eventName) {
    readyToUpdate = true;
  }
  return readyToUpdate;
}

const listSecrets = async (): Promise<readonly SecretVaultInfoUI[]> => {
  const items = await window.listSecrets();
  const current = get(secretVaultInfos);
  return items.map(item => {
    const vaultInfo = secretInfoToVaultInfo(item);
    const existing = current.find(s => s.id === vaultInfo.id);
    if (existing?.actionError) {
      vaultInfo.actionError = existing.actionError;
    }
    return vaultInfo;
  });
};

export const secretVaultEventStore = new EventStore<readonly SecretVaultInfoUI[]>(
  'secret-vault',
  secretVaultInfos,
  checkForUpdate,
  ['secret-manager-update'],
  ['extensions-already-started'],
  listSecrets,
);
secretVaultEventStore.setup();
