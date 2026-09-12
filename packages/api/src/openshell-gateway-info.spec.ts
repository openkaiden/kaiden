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

import { describe, expect, test } from 'vitest';

import { isGatewayVersionCompatible, MIN_GATEWAY_VERSION, SandboxInfoSchema } from './openshell-gateway-info.js';

describe('SandboxInfoSchema created_at transform', () => {
  const baseSandbox = { id: 's1', name: 'test', phase: 'Ready' as const };

  test('should append Z to ISO timestamp without timezone', () => {
    const result = SandboxInfoSchema.parse({ ...baseSandbox, created_at: '2026-07-17T10:00:00' });
    expect(result.created_at).toBe('2026-07-17T10:00:00Z');
  });

  test('should preserve ISO timestamp that already has Z', () => {
    const result = SandboxInfoSchema.parse({ ...baseSandbox, created_at: '2026-07-17T10:00:00Z' });
    expect(result.created_at).toBe('2026-07-17T10:00:00Z');
  });

  test('should preserve ISO timestamp with positive offset', () => {
    const result = SandboxInfoSchema.parse({ ...baseSandbox, created_at: '2026-07-17T10:00:00+02:00' });
    expect(result.created_at).toBe('2026-07-17T10:00:00+02:00');
  });

  test('should preserve ISO timestamp with negative offset', () => {
    const result = SandboxInfoSchema.parse({ ...baseSandbox, created_at: '2026-07-17T10:00:00-05:00' });
    expect(result.created_at).toBe('2026-07-17T10:00:00-05:00');
  });

  test('should handle missing created_at', () => {
    const result = SandboxInfoSchema.parse(baseSandbox);
    expect(result.created_at).toBeUndefined();
  });

  test('should append Z to ISO timestamp with seconds fraction', () => {
    const result = SandboxInfoSchema.parse({ ...baseSandbox, created_at: '2026-07-17T10:00:00.123' });
    expect(result.created_at).toBe('2026-07-17T10:00:00.123Z');
  });

  test('should append Z to space-separated timestamp from openshell', () => {
    const result = SandboxInfoSchema.parse({ ...baseSandbox, created_at: '2026-07-17 14:07:58' });
    expect(result.created_at).toBe('2026-07-17T14:07:58Z');
  });
});

describe('isGatewayVersionCompatible', () => {
  test('returns true when version is undefined', () => {
    expect(isGatewayVersionCompatible(undefined)).toBe(true);
  });

  test('returns true when version equals MIN_GATEWAY_VERSION', () => {
    expect(isGatewayVersionCompatible(MIN_GATEWAY_VERSION)).toBe(true);
  });

  test('returns true when version is above minimum', () => {
    expect(isGatewayVersionCompatible('1.0.0')).toBe(true);
  });

  test('returns false when version is below minimum', () => {
    expect(isGatewayVersionCompatible('0.1.0')).toBe(false);
  });

  test('returns false when only patch is below minimum', () => {
    expect(isGatewayVersionCompatible('0.3.9')).toBe(false);
  });

  test('returns true when patch is above minimum', () => {
    expect(isGatewayVersionCompatible('0.4.1')).toBe(true);
  });

  test('handles v-prefixed versions', () => {
    expect(isGatewayVersionCompatible('v0.4.0')).toBe(true);
    expect(isGatewayVersionCompatible('v0.1.0')).toBe(false);
  });

  test('returns true for unparseable version strings', () => {
    expect(isGatewayVersionCompatible('not-a-version')).toBe(true);
  });
});
