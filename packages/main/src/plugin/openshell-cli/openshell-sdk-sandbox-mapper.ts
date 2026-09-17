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

import type { SandboxPhaseName, SandboxRef } from '@nvidia/openshell-sdk';

import type { SandboxInfo } from '/@api/openshell-gateway-info.js';

const SDK_PHASE_MAP: Record<SandboxPhaseName, SandboxInfo['phase']> = {
  unspecified: 'Unspecified',
  provisioning: 'Provisioning',
  ready: 'Ready',
  error: 'Error',
  deleting: 'Deleting',
  unknown: 'Unknown',
  starting: 'Starting',
  stopping: 'Stopping',
  stopped: 'Stopped',
};

/**
 * Maps an OpenShell SDK {@link SandboxRef} to Kaiden's {@link SandboxInfo}.
 * Converts the SDK's lowercase phase names to PascalCase.
 */
export function mapSdkSandboxRef(ref: SandboxRef): SandboxInfo {
  return {
    id: ref.id,
    name: ref.name,
    phase: SDK_PHASE_MAP[ref.phase] ?? 'Unknown',
    labels: ref.labels,
    resource_version: Number(ref.resourceVersion),
  };
}
