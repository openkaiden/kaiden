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

import { faLayerGroup } from '@fortawesome/free-solid-svg-icons/faLayerGroup';

import type { NavigationRegistryEntry } from './navigation-registry';

export function createNavigationAgentWorkspacesEntry(): NavigationRegistryEntry {
  const registry: NavigationRegistryEntry = {
    name: 'Workspaces',
    icon: { faIcon: { definition: faLayerGroup, size: 'lg' } },
    link: '/agent-workspaces',
    tooltip: 'Agentic Workspaces',
    type: 'entry',
    get counter() {
      return 0;
    },
  };
  return registry;
}
