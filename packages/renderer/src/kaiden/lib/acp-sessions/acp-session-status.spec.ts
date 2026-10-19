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

import type { AcpSessionStatus } from '/@api/acp-session-info';

import {
  ACP_SESSION_STATUS_COLORS,
  getStatusDotClass,
  isTerminalStatus,
  isWorkspaceUnavailable,
} from './acp-session-status';

beforeEach(() => {
  vi.resetAllMocks();
});

test.each(['completed', 'cancelled', 'error'] as AcpSessionStatus[])('isTerminalStatus returns true for %s', status => {
  expect(isTerminalStatus(status)).toBe(true);
});

test.each([
  'idle',
  'running',
  'waiting_input',
] as AcpSessionStatus[])('isTerminalStatus returns false for %s', status => {
  expect(isTerminalStatus(status)).toBe(false);
});

test('isWorkspaceUnavailable returns true when sandboxId is undefined', () => {
  expect(isWorkspaceUnavailable({ sandboxId: undefined })).toBe(true);
});

test('isWorkspaceUnavailable returns false when sandboxId is set', () => {
  expect(isWorkspaceUnavailable({ sandboxId: 'sb-1' })).toBe(false);
});

test.each([
  'idle',
  'running',
  'waiting_input',
  'completed',
  'error',
  'cancelled',
] as AcpSessionStatus[])('getStatusDotClass returns status color for %s when sandbox is available', status => {
  expect(getStatusDotClass({ sandboxId: 'sb-1', status })).toBe(ACP_SESSION_STATUS_COLORS[status]);
});

test.each([
  'idle',
  'running',
  'waiting_input',
] as AcpSessionStatus[])('getStatusDotClass returns idle gray for non-terminal %s without sandbox', status => {
  expect(getStatusDotClass({ sandboxId: undefined, status })).toBe(ACP_SESSION_STATUS_COLORS.idle);
});

test.each([
  'completed',
  'cancelled',
  'error',
] as AcpSessionStatus[])('getStatusDotClass preserves status color for terminal %s without sandbox', status => {
  expect(getStatusDotClass({ sandboxId: undefined, status })).toBe(ACP_SESSION_STATUS_COLORS[status]);
});

test('running status includes pulse animation', () => {
  expect(ACP_SESSION_STATUS_COLORS.running).toContain('animate-pulse');
  expect(ACP_SESSION_STATUS_COLORS.running).toContain('motion-reduce:animate-none');
});

test('waiting_input status includes pulse animation', () => {
  expect(ACP_SESSION_STATUS_COLORS.waiting_input).toContain('animate-pulse');
  expect(ACP_SESSION_STATUS_COLORS.waiting_input).toContain('motion-reduce:animate-none');
});

test('completed status uses connected green, not terminated red', () => {
  expect(ACP_SESSION_STATUS_COLORS.completed).toContain('status-connected');
  expect(ACP_SESSION_STATUS_COLORS.completed).not.toContain('status-terminated');
});
