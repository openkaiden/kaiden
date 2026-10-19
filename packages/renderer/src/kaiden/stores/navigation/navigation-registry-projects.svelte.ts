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

import { faFolderOpen } from '@fortawesome/free-solid-svg-icons/faFolderOpen';

import { workspaceProjectInfos } from '/@/kaiden/stores/workspace-projects';
import type { NavigationRegistryEntry } from '/@/stores/navigation/navigation-registry';

let count = $state(0);

export function createNavigationProjectsEntry(): NavigationRegistryEntry {
  workspaceProjectInfos.subscribe(projects => {
    count = projects.length;
  });

  const registry: NavigationRegistryEntry = {
    name: 'Projects',
    icon: { faIcon: { definition: faFolderOpen, size: 'lg' } },
    link: '/projects',
    tooltip: 'Projects',
    type: 'entry',
    get counter() {
      return count;
    },
  };
  return registry;
}
