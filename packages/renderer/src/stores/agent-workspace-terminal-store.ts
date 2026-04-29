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
import { get, writable } from 'svelte/store';

import { agentWorkspaces } from './agent-workspaces.svelte';

export interface TerminalOfAgentWorkspace {
  workspaceId: string;
  callbackId?: number;
  terminal: string;
}

export const agentWorkspaceTerminals: Writable<TerminalOfAgentWorkspace[]> = writable([]);

agentWorkspaces.subscribe(workspaces => {
  const terminals = get(agentWorkspaceTerminals);
  const toRemove: TerminalOfAgentWorkspace[] = [];
  for (const terminal of terminals) {
    const found = workspaces.find(ws => ws.id === terminal.workspaceId);
    if (!found) {
      toRemove.push(terminal);
    }
  }

  for (const terminal of toRemove) {
    agentWorkspaceTerminals.update(list => {
      const index = list.indexOf(terminal);
      if (index > -1) {
        list.splice(index, 1);
      }
      return list;
    });
  }
});

export function registerTerminal(terminal: TerminalOfAgentWorkspace): void {
  agentWorkspaceTerminals.update(list => {
    return [...list.filter(t => t.workspaceId !== terminal.workspaceId), terminal];
  });
}

export function getExistingTerminal(workspaceId: string): TerminalOfAgentWorkspace | undefined {
  const terminals = get(agentWorkspaceTerminals);
  return terminals.find(terminal => terminal.workspaceId === workspaceId);
}
