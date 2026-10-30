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
import { beforeEach, expect, test } from 'vitest';

import type { GatewaySandboxes } from '/@api/openshell-gateway-info';

import {
  allOpenshellSandboxes,
  clearSandboxActionError,
  openshellSandboxes,
  setSandboxActionError,
} from './openshell-sandboxes';

const gatewaySandboxes: GatewaySandboxes[] = [
  {
    gateway: { name: 'local', endpoint: 'http://localhost:18080', canStop: false },
    sandboxes: [
      { id: 'ws-1', name: 'workspace-1', phase: 'Ready' },
      { id: 'ws-2', name: 'workspace-2', phase: 'Ready' },
    ],
  },
];

beforeEach(() => {
  clearSandboxActionError('ws-1');
  clearSandboxActionError('ws-2');
  openshellSandboxes.set(gatewaySandboxes);
});

test('setSandboxActionError sets actionError on the matching sandbox only', () => {
  setSandboxActionError('ws-2', 'Error: delete failed');

  const sandboxes = get(allOpenshellSandboxes);
  expect(sandboxes.find(s => s.id === 'ws-1')?.actionError).toBeUndefined();
  expect(sandboxes.find(s => s.id === 'ws-2')?.actionError).toBe('Error: delete failed');
});

test('actionError is preserved when sandboxes are refreshed from the backend', () => {
  setSandboxActionError('ws-1', 'Error: delete failed');

  openshellSandboxes.set([
    {
      ...gatewaySandboxes[0],
      sandboxes: [{ id: 'ws-1', name: 'workspace-1', phase: 'Error' }],
    },
  ]);

  const sandboxes = get(allOpenshellSandboxes);
  expect(sandboxes).toEqual([
    { id: 'ws-1', name: 'workspace-1', phase: 'Error', gatewayName: 'local', actionError: 'Error: delete failed' },
  ]);
});

test('clearSandboxActionError removes actionError from the sandbox', () => {
  setSandboxActionError('ws-1', 'Error: delete failed');

  clearSandboxActionError('ws-1');

  expect(get(allOpenshellSandboxes).find(s => s.id === 'ws-1')?.actionError).toBeUndefined();
});
