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

import { faRobot } from '@fortawesome/free-solid-svg-icons/faRobot';
import { get } from 'svelte/store';

import { acpSessions } from '/@/kaiden/stores/acp-sessions.svelte';
import type { NavigationRegistryEntry } from '/@/stores/navigation/navigation-registry';

export function createNavigationAcpSessionsEntry(): NavigationRegistryEntry {
  const registry: NavigationRegistryEntry = {
    name: 'Agents',
    icon: { faIcon: { definition: faRobot, size: 'lg' } },
    link: '/acp-sessions',
    tooltip: 'Agent Sessions',
    type: 'entry',
    hidden: true,
    get counter() {
      return get(acpSessions).filter(s => s.status === 'waiting_input').length;
    },
  };

  window
    .isOpenshellAvailable()
    ?.then(available => {
      registry.hidden = !available;
    })
    ?.catch(() => {
      registry.hidden = true;
    });

  return registry;
}
