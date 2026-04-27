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

import { faKey } from '@fortawesome/free-solid-svg-icons/faKey';

import { secretVaultInfos } from '/@/stores/secret-vault';

import type { NavigationRegistryEntry } from './navigation-registry';

let count = $state(0);

secretVaultInfos.subscribe(infos => {
  count = infos.length;
});

export function createNavigationSecretVaultEntry(): NavigationRegistryEntry {
  const registry: NavigationRegistryEntry = {
    name: 'Secret Vault',
    icon: { faIcon: { definition: faKey, size: 'lg' } },
    link: '/secret-vault',
    tooltip: 'Secret Vault',
    type: 'entry',
    get counter() {
      return count;
    },
  };
  return registry;
}
