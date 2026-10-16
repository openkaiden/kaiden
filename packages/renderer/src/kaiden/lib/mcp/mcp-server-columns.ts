/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { TableColumn } from '@podman-desktop/ui-svelte';
import SimpleColumn from '@podman-desktop/ui-svelte/TableSimpleColumn';

export class MCPServerDescriptionColumn extends TableColumn<{ description: string }, string> {
  constructor() {
    super('Description', {
      width: '3fr',
      renderMapping: (mcpServerDetail): string => mcpServerDetail.description,
      renderer: SimpleColumn,
      comparator: (a, b): number => b.description.localeCompare(a.description),
    });
  }
}
