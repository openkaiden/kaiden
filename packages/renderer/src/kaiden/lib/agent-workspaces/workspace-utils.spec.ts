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

import { beforeEach, expect, test, vi } from 'vitest';

import type { SandboxInfoWithGateway } from '/@/kaiden/stores/openshell-sandboxes';

import {
  getSandboxRunAction,
  isSandboxRunActionEnabled,
  isSandboxTransitioning,
  runSandboxAction,
} from './workspace-utils';

const sandbox: SandboxInfoWithGateway = {
  id: 'sandbox-1',
  name: 'my-sandbox',
  phase: 'Ready',
  gatewayName: 'remote-gateway',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.startOpenshellSandbox).mockResolvedValue(undefined);
  vi.mocked(window.stopOpenshellSandbox).mockResolvedValue(undefined);
});

test.each([
  { phase: 'Ready', expected: 'stop' },
  { phase: 'Stopping', expected: 'stop' },
  { phase: 'Stopped', expected: 'start' },
  { phase: 'Starting', expected: 'start' },
  { phase: 'Error', expected: 'start' },
] as const)('getSandboxRunAction returns $expected for phase $phase', ({ phase, expected }) => {
  expect(getSandboxRunAction(phase)).toBe(expected);
});

test.each([
  { phase: 'Ready', expected: true },
  { phase: 'Stopped', expected: true },
  { phase: 'Starting', expected: false },
  { phase: 'Stopping', expected: false },
  { phase: 'Deleting', expected: false },
  { phase: 'Error', expected: false },
] as const)('isSandboxRunActionEnabled returns $expected for phase $phase', ({ phase, expected }) => {
  expect(isSandboxRunActionEnabled(phase)).toBe(expected);
});

test.each([
  { phase: 'Provisioning', expected: true },
  { phase: 'Starting', expected: true },
  { phase: 'Stopping', expected: true },
  { phase: 'Deleting', expected: true },
  { phase: 'Ready', expected: false },
  { phase: 'Stopped', expected: false },
] as const)('isSandboxTransitioning returns $expected for phase $phase', ({ phase, expected }) => {
  expect(isSandboxTransitioning(phase)).toBe(expected);
});

test('runSandboxAction stops the sandbox on its gateway', async () => {
  await runSandboxAction(sandbox, 'stop');

  expect(window.stopOpenshellSandbox).toHaveBeenCalledWith('my-sandbox', 'remote-gateway');
  expect(window.startOpenshellSandbox).not.toHaveBeenCalled();
});

test('runSandboxAction starts the sandbox on its gateway', async () => {
  await runSandboxAction(sandbox, 'start');

  expect(window.startOpenshellSandbox).toHaveBeenCalledWith('my-sandbox', 'remote-gateway');
  expect(window.stopOpenshellSandbox).not.toHaveBeenCalled();
});

test('runSandboxAction propagates failures', async () => {
  vi.mocked(window.stopOpenshellSandbox).mockRejectedValue(new Error('stop failed'));

  await expect(runSandboxAction(sandbox, 'stop')).rejects.toThrow('stop failed');
});
