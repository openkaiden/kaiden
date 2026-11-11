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

import {
  type GatewayInfo,
  isUsableGateway,
  KAIDEN_LOCAL_GATEWAY_NAME,
  MIN_GATEWAY_VERSION,
} from '/@api/openshell-gateway-info';

export function noUsableGateways(gateways: GatewayInfo[]): boolean {
  return !gateways.some(isUsableGateway);
}

/**
 * A gateway whose recorded process is alive but which is neither reachable nor owned by this session,
 * e.g. a gateway from a previous session that is still shutting down.
 */
export function hasPidConflict(gateway: GatewayInfo): boolean {
  return (
    gateway.gatewayState?.reachable === false && gateway.gatewayState.process?.status === 'running' && !gateway.canStop
  );
}

/**
 * The stopped gateway the warning offers to start, preferring the default gateway when several can be started.
 * Nothing is offered while a PID conflict is reported, so the button never refers to another gateway than the message.
 */
export function getStartableGateway(gateways: GatewayInfo[]): GatewayInfo | undefined {
  if (gateways.some(hasPidConflict)) {
    return undefined;
  }
  const startable = gateways.filter(gateway => gateway.canStart);
  return startable.find(gateway => gateway.name === KAIDEN_LOCAL_GATEWAY_NAME) ?? startable[0];
}

export function getStartButtonLabel(gateway: GatewayInfo): string {
  return gateway.name === KAIDEN_LOCAL_GATEWAY_NAME ? 'Start default gateway' : `Start gateway ${gateway.name}`;
}

/**
 * The error of the last failed start of the gateway the warning offers. Errors are kept per gateway name, so a
 * refetch of the gateway keeps it, and none is shown while no gateway can be started.
 */
export function getStartError(
  errors: ReadonlyMap<string, string>,
  gateway: GatewayInfo | undefined,
): string | undefined {
  return gateway ? errors.get(gateway.name) : undefined;
}

export function getWarningMessage(gateways: GatewayInfo[]): string {
  const conflict = gateways.find(hasPidConflict);
  if (conflict) {
    const pid = conflict.gatewayState?.process?.pid;
    const pidLabel = pid === undefined ? '' : ` (PID ${pid})`;
    const gatewayLabel =
      conflict.name === KAIDEN_LOCAL_GATEWAY_NAME
        ? `the default ${conflict.name} gateway`
        : `the ${conflict.name} gateway`;
    return `A conflicting process${pidLabel} is blocking ${gatewayLabel}. Please wait for it to exit before restarting, clear it, or create a new gateway.`;
  }
  const hasReachableButIncompatible = gateways.some(
    gateway => gateway.gatewayState?.reachable === true && !gateway.gatewayState.compatible,
  );
  if (hasReachableButIncompatible) {
    return `No usable OpenShell gateways available. Minimum required version: ${MIN_GATEWAY_VERSION}.`;
  }
  return 'No usable OpenShell gateways available.';
}
