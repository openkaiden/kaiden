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

import type { SandboxRef } from '@nvidia/openshell-sdk';
import { describe, expect, test } from 'vitest';

import { mapSdkSandboxRef } from './openshell-sdk-sandbox-mapper.js';

function sandboxRef(overrides: Partial<SandboxRef> = {}): SandboxRef {
  return {
    id: 'sb-1',
    name: 'my-sandbox',
    workspace: 'default',
    phase: 'ready',
    labels: {},
    resourceVersion: '42',
    serviceUrls: {},
    restartCount: 0,
    ...overrides,
  };
}

describe('mapSdkSandboxRef', () => {
  test('maps basic fields', () => {
    const result = mapSdkSandboxRef(sandboxRef());

    expect(result).toStrictEqual({
      id: 'sb-1',
      name: 'my-sandbox',
      phase: 'Ready',
      created_at: undefined,
      labels: {},
      resource_version: 42,
    });
  });

  test('maps createdAtMs to ISO string', () => {
    const ms = Date.UTC(2026, 9, 15, 12, 0, 0);
    const result = mapSdkSandboxRef(sandboxRef({ createdAtMs: ms }));

    expect(result.created_at).toBe('2026-10-15T12:00:00.000Z');
  });

  test('leaves created_at undefined when createdAtMs is absent', () => {
    const result = mapSdkSandboxRef(sandboxRef());

    expect(result.created_at).toBeUndefined();
  });

  test.each([
    ['suspending', 'Suspending'],
    ['suspended', 'Suspended'],
  ] as const)('maps %s phase to %s', (phase, expected) => {
    const result = mapSdkSandboxRef(sandboxRef({ phase }));

    expect(result.phase).toBe(expected);
  });

  test('maps unknown phase to Unknown', () => {
    const result = mapSdkSandboxRef(sandboxRef({ phase: 'something-new' as never }));

    expect(result.phase).toBe('Unknown');
  });
});
