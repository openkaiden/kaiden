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

import { type Writable, writable } from 'svelte/store';

import type { AgentWorkspaceSummary } from '/@api/agent-workspace-info';

import { EventStore } from './event-store';

export type AgentWorkspaceState = AgentWorkspaceSummary['state'] | 'starting' | 'stopping';

export const agentWorkspaces: Writable<AgentWorkspaceSummaryUI[]> = writable([]);

export type AgentWorkspaceSummaryUI = Omit<AgentWorkspaceSummary, 'state'> & { state: AgentWorkspaceState };

let readyToUpdate = false;

export async function checkForUpdate(eventName: string): Promise<boolean> {
  if ('system-ready' === eventName) {
    readyToUpdate = true;
  }
  return readyToUpdate;
}

const listWorkspaces = async (): Promise<AgentWorkspaceSummaryUI[]> => {
  return (await window.listAgentWorkspaces()) as AgentWorkspaceSummaryUI[];
};

export const agentWorkspacesEventStore = new EventStore<AgentWorkspaceSummaryUI[]>(
  'agent-workspaces',
  agentWorkspaces,
  checkForUpdate,
  ['agent-workspace-update'],
  ['system-ready'],
  listWorkspaces,
);
agentWorkspacesEventStore.setup();

function setWorkspaceState(id: string, state: AgentWorkspaceState): boolean {
  let found = false;
  agentWorkspaces.update(workspaces => {
    const updatedWorkspaces = workspaces.map(workspace => {
      if (workspace.id !== id) {
        return workspace;
      }
      found = true;
      return { ...workspace, state };
    });
    return found ? updatedWorkspaces : workspaces;
  });
  return found;
}

export async function startAgentWorkspace(id: string): Promise<void> {
  if (!setWorkspaceState(id, 'starting')) {
    throw new Error(`Invalid workspace id: ${id}`);
  }
  try {
    await window.startAgentWorkspace(id);
    setWorkspaceState(id, 'running');
  } catch (error: unknown) {
    setWorkspaceState(id, 'stopped');
    console.error('Failed to start agent workspace', error);
    throw error;
  }
}

export async function stopAgentWorkspace(id: string): Promise<void> {
  if (!setWorkspaceState(id, 'stopping')) {
    throw new Error(`Invalid workspace id: ${id}`);
  }
  try {
    await window.stopAgentWorkspace(id);
    setWorkspaceState(id, 'stopped');
  } catch (error: unknown) {
    setWorkspaceState(id, 'running');
    console.error('Failed to stop agent workspace', error);
    throw error;
  }
}
