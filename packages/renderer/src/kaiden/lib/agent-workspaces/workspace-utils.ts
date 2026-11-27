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

import type { SandboxInfoWithGateway } from '/@/kaiden/stores/openshell-sandboxes';
import { AGENT_LABEL } from '/@api/openshell-gateway-info';

export const ACTIVE_GROUP_LABEL = 'Active';
export const STOPPED_GROUP_LABEL = 'Stopped';

export function isActiveWorkspace(sandbox: SandboxInfoWithGateway): boolean {
  return sandbox.phase === 'Ready';
}

export function getReferenceTime(sandbox: SandboxInfoWithGateway): string | undefined {
  return sandbox.created_at;
}

export function getAgentId(sandbox?: SandboxInfoWithGateway): string | undefined {
  return sandbox?.labels?.[AGENT_LABEL];
}

export type SandboxRunAction = 'start' | 'stop';

const TRANSITIONAL_PHASES: ReadonlyArray<SandboxInfoWithGateway['phase']> = [
  'Provisioning',
  'Starting',
  'Stopping',
  'Deleting',
];

// action offered by the start/stop toggle: stop while the sandbox runs (or is stopping), start otherwise
export function getSandboxRunAction(phase: SandboxInfoWithGateway['phase']): SandboxRunAction {
  return phase === 'Ready' || phase === 'Stopping' ? 'stop' : 'start';
}

export function isSandboxRunActionEnabled(phase: SandboxInfoWithGateway['phase']): boolean {
  return phase === 'Ready' || phase === 'Stopped';
}

export function isSandboxTransitioning(phase: SandboxInfoWithGateway['phase']): boolean {
  return TRANSITIONAL_PHASES.includes(phase);
}

export async function runSandboxAction(sandbox: SandboxInfoWithGateway, action: SandboxRunAction): Promise<void> {
  if (action === 'stop') {
    await window.stopOpenshellSandbox(sandbox.name, sandbox.gatewayName);
  } else {
    await window.startOpenshellSandbox(sandbox.name, sandbox.gatewayName);
  }
}
