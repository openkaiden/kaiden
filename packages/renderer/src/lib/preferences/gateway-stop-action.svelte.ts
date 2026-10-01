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

export class GatewayStopAction {
  stoppingGateways = $state<string[]>([]);
  error = $state('');

  async stop(name: string): Promise<void> {
    if (this.stoppingGateways.includes(name)) return;
    this.stoppingGateways = [...this.stoppingGateways, name];
    this.error = '';
    try {
      await window.stopOpenshellGateway(name);
    } catch (err: unknown) {
      this.error = `Failed to stop gateway "${name}": ${err instanceof Error ? err.message : String(err)}`;
      console.error(this.error);
    } finally {
      this.stoppingGateways = this.stoppingGateways.filter(gateway => gateway !== name);
    }
  }
}
