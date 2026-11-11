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

import { expect, test } from 'vitest';

import { type GatewayInfo, type GatewayState, MIN_GATEWAY_VERSION } from '/@api/openshell-gateway-info';

import {
  getStartableGateway,
  getStartButtonLabel,
  getStartError,
  getWarningMessage,
  hasPidConflict,
  noUsableGateways,
} from './no-usable-gateway-warning';

const usable: GatewayInfo = {
  name: 'gw',
  endpoint: 'http://localhost',
  canStop: false,
  canStart: false,
  version: MIN_GATEWAY_VERSION,
  gatewayState: { reachable: true, health: 'healthy', compatible: true },
};

const incompatible: GatewayInfo = {
  name: 'old',
  endpoint: 'http://localhost',
  canStop: false,
  canStart: false,
  version: '0.0.1',
  gatewayState: { reachable: true, health: 'healthy', compatible: false },
};

const unreachable: GatewayInfo = {
  name: 'down',
  endpoint: 'http://localhost',
  canStop: false,
  canStart: false,
  gatewayState: { reachable: false, health: 'unknown', compatible: true },
};

const pidConflictState: GatewayState = {
  reachable: false,
  health: 'unknown',
  compatible: true,
  process: { pid: 4242, status: 'running' },
};

const pidConflict: GatewayInfo = {
  name: 'kaiden-local',
  endpoint: 'http://127.0.0.1:29670',
  canStop: false,
  canStart: false,
  gatewayState: pidConflictState,
};

const stopped: GatewayInfo = {
  name: 'stopped',
  endpoint: 'http://127.0.0.1:29671',
  canStop: false,
  canStart: true,
  gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
};

test('noUsableGateways returns true for empty list', () => {
  expect(noUsableGateways([])).toBe(true);
});

test('noUsableGateways returns false when a usable gateway exists', () => {
  expect(noUsableGateways([usable])).toBe(false);
});

test('noUsableGateways returns true when all gateways are incompatible or unreachable', () => {
  expect(noUsableGateways([incompatible, unreachable])).toBe(true);
});

test('getWarningMessage includes minimum version when gateways are reachable but incompatible', () => {
  expect(getWarningMessage([incompatible])).toContain(MIN_GATEWAY_VERSION);
});

test('getWarningMessage includes minimum version when a reachable gateway is incompatible and another is unreachable', () => {
  expect(getWarningMessage([incompatible, unreachable])).toContain(MIN_GATEWAY_VERSION);
});

test('getWarningMessage omits minimum version when gateways are unreachable', () => {
  expect(getWarningMessage([unreachable])).toBe('No usable OpenShell gateways available.');
});

test('getWarningMessage reports a PID conflict without asking to start the gateway yet', () => {
  expect(getWarningMessage([unreachable, pidConflict])).toBe(
    'A conflicting process (PID 4242) is blocking the default kaiden-local gateway. Please wait for it to exit before restarting, clear it, or create a new gateway.',
  );
});

test('getWarningMessage names a non-default gateway in a PID conflict', () => {
  expect(getWarningMessage([{ ...pidConflict, name: 'local-dev' }])).toBe(
    'A conflicting process (PID 4242) is blocking the local-dev gateway. Please wait for it to exit before restarting, clear it, or create a new gateway.',
  );
});

test.each<[string, GatewayInfo, boolean]>([
  ['an unreachable gateway with a running process it cannot stop', pidConflict, true],
  ['a gateway still starting in this session', { ...pidConflict, canStop: true }, false],
  [
    'a reachable gateway with a running process',
    { ...pidConflict, gatewayState: { ...pidConflictState, reachable: true } },
    false,
  ],
  ['an unreachable gateway without a running process', unreachable, false],
])('hasPidConflict for %s is %s', (_label, gateway, expected) => {
  expect(hasPidConflict(gateway)).toBe(expected);
});

test('getStartableGateway only returns a gateway that can be started, and none during a PID conflict', () => {
  expect(getStartableGateway([unreachable, pidConflict])).toBeUndefined();
  expect(getStartableGateway([pidConflict, stopped])).toBeUndefined();
  expect(getStartableGateway([unreachable, stopped])).toBe(stopped);
  expect(getStartableGateway([unreachable, incompatible])).toBeUndefined();
});

test('getStartableGateway prefers the default gateway when several can be started', () => {
  const stoppedDefault: GatewayInfo = { ...stopped, name: 'kaiden-local' };
  expect(getStartableGateway([stopped, stoppedDefault])).toBe(stoppedDefault);
});

test.each([
  ['kaiden-local', 'Start default gateway'],
  ['local-dev', 'Start gateway local-dev'],
])('getStartButtonLabel for %s is "%s"', (name, label) => {
  expect(getStartButtonLabel({ ...stopped, name })).toBe(label);
});

test('getStartError returns the start error of the offered gateway, also after a refetch', () => {
  const errors = new Map([['stopped', 'Port 29671 is busy']]);
  expect(getStartError(errors, { ...stopped })).toBe('Port 29671 is busy');
  expect(getStartError(errors, { ...stopped, name: 'other' })).toBeUndefined();
  expect(getStartError(errors, undefined)).toBeUndefined();
});
