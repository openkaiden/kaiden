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

import type { GatewayInfo } from './openshell-gateway-info.js';
import { isUsableGateway, SandboxInfoSchema } from './openshell-gateway-info.js';

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

describe('isUsableGateway', () => {
  const gateway = (state?: GatewayInfo['gatewayState']): GatewayInfo =>
    ({ name: 'gw', endpoint: 'http://localhost', canStop: false, gatewayState: state }) as GatewayInfo;

  test('returns true when reachable and compatible', () => {
    expect(isUsableGateway(gateway({ reachable: true, health: 'healthy', compatible: true }))).toBe(true);
  });

  test('returns false when reachable but incompatible', () => {
    expect(isUsableGateway(gateway({ reachable: true, health: 'healthy', compatible: false }))).toBe(false);
  });

  test('returns false when unreachable', () => {
    expect(isUsableGateway(gateway({ reachable: false, health: 'unknown', compatible: true }))).toBe(false);
  });

  test('returns false when gatewayState is undefined', () => {
    expect(isUsableGateway(gateway())).toBe(false);
  });
});
