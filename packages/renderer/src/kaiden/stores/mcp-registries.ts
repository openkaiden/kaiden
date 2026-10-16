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

import type * as kaidenAPI from '@openkaiden/api';
import type { Writable } from 'svelte/store';
import { writable } from 'svelte/store';

/**
 * Compares MCP registry base URLs in a stable host/path form so suggested vs configured
 * entries match whether the main process stored `https://…` (after normalization) or host-only.
 */
function comparableMcpRegistryBaseUrl(url: string): string {
  let s = url.trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('https://')) {
    s = s.slice(8);
  } else if (lower.startsWith('http://')) {
    s = s.slice(7);
  }
  while (s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}

export async function fetchRegistries(): Promise<void> {
  const registries = await window.getMcpRegistries();
  const suggestedRegistries = await window.getMcpSuggestedRegistries();

  // Before we set the registry, let's try and find an appropriate icon and name.
  // Go through each registry, search if it's within the "suggestedRegistry" list,
  // this means that Podman Desktop has a suggested icon and name for this registry.
  // If so, let's update the list.
  registries.forEach(registry => {
    const found = suggestedRegistries.find(
      suggested => comparableMcpRegistryBaseUrl(suggested.url) === comparableMcpRegistryBaseUrl(registry.serverUrl),
    );
    if (found) {
      registry.icon = found.icon;
      registry.name = found.name;
    }
  });
  mcpRegistriesInfos.set(registries);

  // Filter out registries from suggestedRegistries so we do not repeat suggesting them when the user already has
  // credentials added.
  const filteredSuggested = suggestedRegistries.filter(suggested => {
    const found = registries.find(
      registry => comparableMcpRegistryBaseUrl(registry.serverUrl) === comparableMcpRegistryBaseUrl(suggested.url),
    );
    return !found;
  });
  mcpRegistriesSuggestedInfos.set(filteredSuggested);
}

export const mcpRegistriesInfos: Writable<readonly kaidenAPI.MCPRegistry[]> = writable([]);

export const mcpRegistriesSuggestedInfos: Writable<readonly kaidenAPI.RegistrySuggestedProvider[]> = writable([]);

export const searchPattern = writable('');

// need to refresh when new registry are updated/deleted
window.events?.receive('mcp-registry-register', () => {
  fetchRegistries().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});

window.events?.receive('mcp-registry-unregister', () => {
  fetchRegistries().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});

window.events?.receive('mcp-registry-update', () => {
  fetchRegistries().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});

window.addEventListener('system-ready', () => {
  fetchRegistries().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});

window.events?.receive('extensions-started', () => {
  fetchRegistries().catch((error: unknown) => {
    console.error('Failed to fetch registries entries', error);
  });
});
