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
import { inject, injectable } from 'inversify';

import type { OpenshellPolicy } from './openshell-network-policy.js';
import { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

@injectable()
export class OpenshellPolicyManager {
  constructor(
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
  ) {}

  async updatePolicy(sandboxName: string, policy: OpenshellPolicy, gateway?: string): Promise<void> {
    const client = await this.sdkClientManager.getClient(gateway);
    const config = await client.sandbox.getConfig(sandboxName);
    const currentPolicy = config.policy;
    // The gateway adds provider rules back when composing the effective policy.
    const baseNetworkPolicies = Object.fromEntries(
      Object.entries(currentPolicy?.networkPolicies ?? {}).filter(([name]) => !name.startsWith('_provider_')),
    );
    const result = await client.sandbox.setPolicy(sandboxName, {
      version: currentPolicy?.version ?? policy.version,
      filesystem: currentPolicy?.filesystem,
      landlock: currentPolicy?.landlock,
      process: currentPolicy?.process,
      networkPolicies: {
        ...baseNetworkPolicies,
        ...policy.networkPolicies,
      },
      networkMiddlewares: currentPolicy?.networkMiddlewares,
    });
    // The SDK's hash-based wait can finish before the sandbox reports the revision loaded.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const { revision } = await client.raw.getSandboxPolicyStatus(
        { name: sandboxName, version: result.version },
        { timeoutMs: Math.max(1, deadline - Date.now()) },
      );
      if (revision?.status === PolicyStatus.LOADED) return;
      if (revision?.status === PolicyStatus.FAILED) {
        throw new Error(`OpenShell policy version ${result.version} failed to load: ${revision.loadError}`);
      }
      if (revision?.status === PolicyStatus.SUPERSEDED) {
        throw new Error(`OpenShell policy version ${result.version} was superseded before loading`);
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000, Math.max(0, deadline - Date.now()))));
    }
    throw new Error(`Timed out waiting for OpenShell policy version ${result.version} to load`);
  }
}
