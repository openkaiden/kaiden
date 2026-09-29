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

import { type GatewayInfo, MIN_GATEWAY_VERSION } from '/@api/openshell-gateway-info';

import { getWarningMessage, noUsableGateways } from './no-usable-gateway-warning';

const usable: GatewayInfo = {
  name: 'gw',
  endpoint: 'http://localhost',
  canStop: false,
  version: MIN_GATEWAY_VERSION,
  gatewayState: { reachable: true, health: 'healthy', compatible: true },
};

const incompatible: GatewayInfo = {
  name: 'old',
  endpoint: 'http://localhost',
  canStop: false,
  version: '0.0.1',
  gatewayState: { reachable: true, health: 'healthy', compatible: false },
};

const unreachable: GatewayInfo = {
  name: 'down',
  endpoint: 'http://localhost',
  canStop: false,
  gatewayState: { reachable: false, health: 'unknown', compatible: true },
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

test('getWarningMessage omits minimum version when gateways are unreachable', () => {
  expect(getWarningMessage([unreachable])).toBe('No usable OpenShell gateways available.');
});
