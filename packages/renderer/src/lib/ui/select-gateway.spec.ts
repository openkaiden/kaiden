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
  { case: 'uses the active gateway', gateways: [gateway('a'), gateway('b', true)], expected: 'b' },
  { case: 'uses the only gateway when none is active', gateways: [gateway('a')], expected: 'a' },
  {
    case: 'returns empty with several inactive gateways',
    gateways: [gateway('a'), gateway('b')],
    expected: '',
  },
  { case: 'returns empty without gateways', gateways: [], expected: '' },
])('$case', ({ gateways, expected }) => {
  expect(selectGateway(gateways)).toBe(expected);
});
