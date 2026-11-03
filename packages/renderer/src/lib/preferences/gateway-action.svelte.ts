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

// Tracks a per-gateway lifecycle operation: pending gateways and the last error for each.
export class GatewayAction {
  pendingGateways = $state<string[]>([]);
  errors = new SvelteMap<string, string>();

  constructor(private readonly operation: (name: string) => Promise<void>) {}

  async run(name: string): Promise<void> {
    if (this.pendingGateways.includes(name)) return;
    this.pendingGateways = [...this.pendingGateways, name];
    this.errors.delete(name);
    try {
      await this.operation(name);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      this.errors.set(name, error);
      console.error(error);
    } finally {
      this.pendingGateways = this.pendingGateways.filter(gateway => gateway !== name);
    }
  }
}
