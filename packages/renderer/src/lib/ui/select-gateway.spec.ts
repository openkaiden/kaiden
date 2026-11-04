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

import type { GatewayInfo } from '/@api/openshell-gateway-info';

import { selectGateway } from './select-gateway';

function gateway(name: string, active = false): GatewayInfo {
  return { name, endpoint: `http://${name}`, canStop: false, canStart: false, active };
}

test.each([
  { case: 'keeps the picked gateway', gateways: [gateway('a', true), gateway('b')], picked: 'b', expected: 'b' },
  {
    case: 'falls back to the active gateway',
    gateways: [gateway('a'), gateway('b', true)],
    picked: undefined,
    expected: 'b',
  },
  { case: 'drops a picked gateway no longer listed', gateways: [gateway('a', true)], picked: 'gone', expected: 'a' },
  { case: 'uses the only gateway when none is active', gateways: [gateway('a')], picked: undefined, expected: 'a' },
  {
    case: 'returns empty with several inactive gateways',
    gateways: [gateway('a'), gateway('b')],
    picked: undefined,
    expected: '',
  },
  { case: 'returns empty without gateways', gateways: [], picked: 'a', expected: '' },
])('$case', ({ gateways, picked, expected }) => {
  expect(selectGateway(gateways, picked)).toBe(expected);
});
