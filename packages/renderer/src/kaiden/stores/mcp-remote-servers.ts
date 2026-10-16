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

import type { Writable } from 'svelte/store';
import { derived, writable } from 'svelte/store';

import { findMatchInLeaves } from '/@/stores/search-util';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

export const mcpRemoteServerInfos: Writable<readonly MCPRemoteServerInfo[]> = writable([]);
export const mcpRemoteServerInfosStatus = writable<'idle' | 'loading' | 'loaded' | 'error'>('idle');

export const mcpRemoteServerInfoSearchPattern = writable('');

export const filteredMcpRemoteServerInfos = derived(
  [mcpRemoteServerInfos, mcpRemoteServerInfoSearchPattern],
  ([$mcpRemoteServerInfos, $mcpRemoteServerInfoSearchPattern]) => {
    return $mcpRemoteServerInfoSearchPattern.trim().length
      ? $mcpRemoteServerInfos.filter(server => findMatchInLeaves(server, $mcpRemoteServerInfoSearchPattern))
      : $mcpRemoteServerInfos;
  },
);

export async function fetchMcpRemoteServers(): Promise<void> {
  mcpRemoteServerInfosStatus.set('loading');
  try {
    const data = await window.fetchMcpRemoteServers();
    mcpRemoteServerInfos.set(data);
    mcpRemoteServerInfosStatus.set('loaded');
  } catch (error) {
    mcpRemoteServerInfosStatus.set('error');
    throw error;
  }
}

// need to refresh when new registry are updated/deleted
window.events?.receive('mcp-manager-update', () => {
  fetchMcpRemoteServers().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});

window.addEventListener('system-ready', () => {
  fetchMcpRemoteServers().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});
