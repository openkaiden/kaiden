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

import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import { agentWorkspaceTerminals, getExistingTerminal, registerTerminal } from './agent-workspace-terminal-store';
import { agentWorkspaces } from './agent-workspaces.svelte';

beforeEach(() => {
  vi.resetAllMocks();
  agentWorkspaceTerminals.set([]);
});

test('registers and retrieves a terminal by workspace id', () => {
  registerTerminal({ workspaceId: 'ws-1', terminal: 'buffer-content' });

  const terminal = getExistingTerminal('ws-1');
  expect(terminal).toBeDefined();
  expect(terminal?.terminal).toBe('buffer-content');
});

test('returns undefined for non-existent workspace terminal', () => {
  const terminal = getExistingTerminal('ws-unknown');
  expect(terminal).toBeUndefined();
});

test('replaces existing terminal for the same workspace', () => {
  registerTerminal({ workspaceId: 'ws-1', terminal: 'old-buffer' });
  registerTerminal({ workspaceId: 'ws-1', terminal: 'new-buffer' });

  const terminals = get(agentWorkspaceTerminals);
  expect(terminals).toHaveLength(1);
  expect(terminals[0]?.terminal).toBe('new-buffer');
});

test('removes terminal entries when workspace disappears from agentWorkspaces', () => {
  agentWorkspaces.set([
    {
      id: 'ws-1',
      name: 'test',
      project: 'proj',
      agent: 'agent',
      state: 'stopped',
      paths: { source: '/s', configuration: '/c' },
    },
  ]);

  registerTerminal({ workspaceId: 'ws-1', terminal: 'buffer' });
  expect(get(agentWorkspaceTerminals)).toHaveLength(1);

  agentWorkspaces.set([]);
  expect(get(agentWorkspaceTerminals)).toHaveLength(0);
});

test('keeps terminal entries when workspace still exists', () => {
  agentWorkspaces.set([
    {
      id: 'ws-1',
      name: 'test',
      project: 'proj',
      agent: 'agent',
      state: 'stopped',
      paths: { source: '/s', configuration: '/c' },
    },
  ]);

  registerTerminal({ workspaceId: 'ws-1', terminal: 'buffer' });

  agentWorkspaces.set([
    {
      id: 'ws-1',
      name: 'test',
      project: 'proj',
      agent: 'agent',
      state: 'stopped',
      paths: { source: '/s', configuration: '/c' },
    },
  ]);
  expect(get(agentWorkspaceTerminals)).toHaveLength(1);
});
