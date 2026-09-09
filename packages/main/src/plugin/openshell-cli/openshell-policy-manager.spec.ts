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

import { PolicyStatus } from '@nvidia/openshell-sdk/raw';
import { beforeEach, expect, test, vi } from 'vitest';

import { buildPolicyObject } from './openshell-network-policy.js';
import { OpenshellPolicyManager } from './openshell-policy-manager.js';
import { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

vi.mock(import('./openshell-sdk-client-manager.js'));

const sdkClientManager = new OpenshellSdkClientManager({} as never, {} as never);
const manager = new OpenshellPolicyManager(sdkClientManager);
const getConfig = vi.fn();
const setPolicy = vi.fn();
const getSandboxPolicyStatus = vi.fn();
const policy = buildPolicyObject({ mode: 'deny', hosts: ['registry.npmjs.org'] }, 'https://inference.example.com')!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sdkClientManager.getClient).mockResolvedValue({
    sandbox: { getConfig, setPolicy },
    raw: { getSandboxPolicyStatus },
  } as never);
  getConfig.mockResolvedValue({ policy: { version: 1, networkPolicies: {} } });
  setPolicy.mockResolvedValue({ version: 7 });
  getSandboxPolicyStatus.mockResolvedValue({ revision: { status: PolicyStatus.LOADED } });
});

test('preserves existing policy and applies structured network and model rules on the selected gateway', async () => {
  const existingPolicy = {
    version: 1,
    filesystem: { includeWorkdir: true, readWrite: ['/sandbox'] },
    landlock: { compatibility: 'best_effort' },
    process: { runAsUser: 'sandbox', runAsGroup: 'sandbox' },
    networkPolicies: { existing: { endpoints: [{ host: 'example.com', port: 443 }], binaries: [] } },
    networkMiddlewares: { audit: { name: 'audit', middleware: 'audit' } },
  };
  getConfig.mockResolvedValue({ policy: existingPolicy });

  await manager.updatePolicy('my-sandbox', policy, 'remote');

  expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  expect(getConfig).toHaveBeenCalledWith('my-sandbox');
  expect(setPolicy).toHaveBeenCalledWith('my-sandbox', {
    ...existingPolicy,
    networkPolicies: { ...existingPolicy.networkPolicies, ...policy.networkPolicies },
  });
  expect(getSandboxPolicyStatus).toHaveBeenCalledWith(
    { name: 'my-sandbox', version: 7 },
    { timeoutMs: expect.any(Number) },
  );
});

test('waits for the submitted revision to load', async () => {
  getSandboxPolicyStatus.mockResolvedValueOnce({ revision: { status: PolicyStatus.PENDING } });

  await manager.updatePolicy('my-sandbox', policy);

  expect(getSandboxPolicyStatus).toHaveBeenCalledTimes(2);
});

test.each([
  { status: PolicyStatus.FAILED, loadError: 'invalid rule', message: 'failed to load: invalid rule' },
  { status: PolicyStatus.SUPERSEDED, loadError: '', message: 'was superseded before loading' },
])('rejects policy revision status $status', async ({ status, loadError, message }) => {
  getSandboxPolicyStatus.mockResolvedValue({ revision: { status, loadError } });

  await expect(manager.updatePolicy('my-sandbox', policy)).rejects.toThrow(message);
});

test('propagates a rejected policy update without polling', async () => {
  setPolicy.mockRejectedValue(new Error('invalid policy'));

  await expect(manager.updatePolicy('my-sandbox', policy)).rejects.toThrow('invalid policy');

  expect(getSandboxPolicyStatus).not.toHaveBeenCalled();
});

test('times out when the revision remains pending', async () => {
  vi.useFakeTimers();
  try {
    getSandboxPolicyStatus.mockResolvedValue({ revision: { status: PolicyStatus.PENDING } });
    const update = manager.updatePolicy('my-sandbox', policy);
    const rejection = expect(update).rejects.toThrow('Timed out waiting for OpenShell policy version 7 to load');
    // Wait until the dynamic SDK import has completed and polling has started.
    await vi.waitFor(() => expect(getSandboxPolicyStatus).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
  } finally {
    vi.useRealTimers();
  }
});
