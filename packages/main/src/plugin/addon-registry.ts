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

import type { Addon, AddonRegistration } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

import { Disposable } from './types/disposable.js';

@injectable()
export class AddonRegistry {
  private static readonly NAME_PATTERN = /^[a-z0-9-]+$/;

  private readonly addons = new Map<string, Addon>();

  private readonly _onDidChange = new Emitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(
    @inject(ApiSenderType) private readonly apiSender: ApiSenderType,
    @inject(IPCHandle) private readonly ipcHandle: IPCHandle,
  ) {}

  init(): void {
    this.ipcHandle('addon-registry:getAddons', async (): Promise<ReadonlyArray<Addon>> => {
      return this.getAddons();
    });
  }

  registerAddon(registration: AddonRegistration): Disposable {
    this.checkName('publisher name', registration.publisher.name);
    this.checkName('name', registration.name);
    const id = `${registration.publisher.name}.${registration.name}`;
    if (this.addons.has(id)) {
      throw new Error(`Addon with id '${id}' is already registered`);
    }

    this.addons.set(id, { ...registration, publisher: { ...registration.publisher }, id });
    this.notifyChange();
    return Disposable.create(() => {
      this.addons.delete(id);
      this.notifyChange();
    });
  }

  private checkName(label: string, value: string): void {
    if (!AddonRegistry.NAME_PATTERN.test(value)) {
      throw new Error(`Invalid addon ${label} '${value}': only lowercase letters, digits and '-' are allowed`);
    }
  }

  private notifyChange(): void {
    this.apiSender.send('addon-registry:updated');
    this._onDidChange.fire();
  }

  getAddons(): ReadonlyArray<Addon> {
    return Array.from(this.addons.values());
  }

  getAddon(id: string): Addon | undefined {
    return this.addons.get(id);
  }
}
