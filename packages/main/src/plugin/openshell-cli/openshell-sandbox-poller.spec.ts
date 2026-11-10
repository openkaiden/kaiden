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

import { Emitter } from '/@/plugin/events/emitter.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { OpenshellSandboxPoller } from '/@/plugin/openshell-cli/openshell-sandbox-poller.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-state-manager.js'));

function gateway(name: string, reachable: boolean): GatewayInfo {
  return {
    name,
    endpoint: `http://${name}:17670`,
    canStop: false,
    canStart: false,
    gatewayState: { reachable, health: reachable ? 'healthy' : 'unknown', compatible: true },
  };
}

function defineField(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true });
}

let gatewayStateManager: OpenshellGatewayStateManager;
let onDidUpdateGateways: Emitter<readonly GatewayInfo[]>;
let apiSender: ApiSenderType;
let poller: OpenshellSandboxPoller;

function updateGateways(gateways: readonly GatewayInfo[]): void {
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue(gateways);
  onDidUpdateGateways.fire(gateways);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();

  gatewayStateManager = OpenshellGatewayStateManager.prototype;
  onDidUpdateGateways = new Emitter<readonly GatewayInfo[]>();
  defineField(gatewayStateManager, 'onDidUpdateGateways', onDidUpdateGateways.event);
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue([]);

  apiSender = { send: vi.fn(), receive: vi.fn() };
  poller = new OpenshellSandboxPoller(gatewayStateManager, apiSender);
  poller.init();
});

test('starts polling when a gateway becomes reachable', () => {
  updateGateways([gateway('local', true)]);

  vi.advanceTimersByTime(5_000);
  expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
});

test('emits update on every poll tick while gateway is reachable', () => {
  updateGateways([gateway('local', true)]);

  vi.advanceTimersByTime(15_000);
  expect(apiSender.send).toHaveBeenCalledTimes(3);
});

test('stops polling when gateway becomes unreachable', () => {
  updateGateways([gateway('local', true)]);
  vi.advanceTimersByTime(5_000);
  vi.mocked(apiSender.send).mockClear();

  updateGateways([gateway('local', false)]);
  // One final event is emitted on the transition.
  expect(apiSender.send).toHaveBeenCalledExactlyOnceWith('agent-workspace-update');
  vi.mocked(apiSender.send).mockClear();

  vi.advanceTimersByTime(10_000);
  expect(apiSender.send).not.toHaveBeenCalled();
});

test('emits a final update when the last gateway becomes unreachable', () => {
  updateGateways([gateway('a', true), gateway('b', true)]);
  vi.advanceTimersByTime(5_000);
  vi.mocked(apiSender.send).mockClear();

  updateGateways([gateway('a', false), gateway('b', false)]);

  expect(apiSender.send).toHaveBeenCalledExactlyOnceWith('agent-workspace-update');
});

test('does not start polling when all gateways are unreachable', () => {
  updateGateways([gateway('local', false)]);

  vi.advanceTimersByTime(10_000);
  expect(apiSender.send).not.toHaveBeenCalled();
});

test('keeps polling when one of multiple gateways becomes unreachable', () => {
  updateGateways([gateway('a', true), gateway('b', true)]);
  vi.advanceTimersByTime(5_000);
  vi.mocked(apiSender.send).mockClear();

  updateGateways([gateway('a', true), gateway('b', false)]);
  vi.advanceTimersByTime(5_000);

  expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
});

test('starts polling for gateways already reachable at init', () => {
  poller.dispose();

  vi.mocked(gatewayStateManager.listGateways).mockReturnValue([gateway('local', true)]);
  poller = new OpenshellSandboxPoller(gatewayStateManager, apiSender);
  poller.init();

  vi.advanceTimersByTime(5_000);
  expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
});

test('resumes polling when a gateway recovers after being unreachable', () => {
  updateGateways([gateway('local', true)]);
  vi.advanceTimersByTime(5_000);
  vi.mocked(apiSender.send).mockClear();

  updateGateways([gateway('local', false)]);
  vi.mocked(apiSender.send).mockClear();

  vi.advanceTimersByTime(10_000);
  expect(apiSender.send).not.toHaveBeenCalled();

  updateGateways([gateway('local', true)]);
  vi.advanceTimersByTime(5_000);
  expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
});

test('stops polling on dispose', () => {
  updateGateways([gateway('local', true)]);
  vi.advanceTimersByTime(5_000);
  vi.mocked(apiSender.send).mockClear();

  poller.dispose();

  vi.advanceTimersByTime(10_000);
  expect(apiSender.send).not.toHaveBeenCalled();
});

test('stops reacting to gateway updates after dispose', () => {
  poller.dispose();

  updateGateways([gateway('local', true)]);

  vi.advanceTimersByTime(10_000);
  expect(apiSender.send).not.toHaveBeenCalled();
});

test('does not create duplicate timers when gateways update without transition', () => {
  updateGateways([gateway('local', true)]);
  vi.advanceTimersByTime(5_000);
  vi.mocked(apiSender.send).mockClear();

  // Another update with the gateway still reachable
  updateGateways([gateway('local', true)]);
  vi.advanceTimersByTime(5_000);

  // Should still get exactly one tick (not two from duplicate intervals)
  expect(apiSender.send).toHaveBeenCalledOnce();
});
