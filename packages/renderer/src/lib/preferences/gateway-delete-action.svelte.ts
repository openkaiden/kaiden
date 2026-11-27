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

import { SvelteMap } from 'svelte/reactivity';

import { type GatewayInfo, KAIDEN_LOCAL_GATEWAY_NAME } from '/@api/openshell-gateway-info';

export class GatewayDeleteAction {
  private static readonly DELETE_WARNING =
    'If the gateway was created here, it is stopped and its registration and local files (database, certificates, logs, workspace settings and VM sandboxes) are permanently deleted. Sandboxes of podman and docker gateways are not deleted: their containers stay in the container engine. This cannot be undone.';
  private static readonly KAIDEN_LOCAL_NOTE =
    `A new ${KAIDEN_LOCAL_GATEWAY_NAME} gateway may be created automatically the next time the application starts.`;

  deletingGateways = $state<string[]>([]);
  errors = new SvelteMap<string, string>();

  /** System gateways are installed outside the user config and cannot be removed by Kaiden. */
  canDelete(gateway: GatewayInfo): boolean {
    return gateway.source !== 'system';
  }

  async delete(name: string): Promise<void> {
    if (this.deletingGateways.includes(name)) return;
    const result = await window.showMessageBox({
      title: 'Delete gateway',
      type: 'warning',
      message: `Delete gateway "${name}"?`,
      detail:
        name === KAIDEN_LOCAL_GATEWAY_NAME
          ? `${GatewayDeleteAction.DELETE_WARNING} ${GatewayDeleteAction.KAIDEN_LOCAL_NOTE}`
          : GatewayDeleteAction.DELETE_WARNING,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) return;
    // The confirmation is async, so another delete of the same gateway may have started meanwhile.
    if (this.deletingGateways.includes(name)) return;
    this.deletingGateways = [...this.deletingGateways, name];
    this.errors.delete(name);
    try {
      await window.deleteOpenshellGateway(name);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.errors.set(name, error);
      console.error(`Failed to delete gateway "${name}": ${error}`);
    } finally {
      this.deletingGateways = this.deletingGateways.filter(gateway => gateway !== name);
    }
  }
}
