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

import type { Addon } from '@openkaiden/api';
import { injectable } from 'inversify';

import { Disposable } from './types/disposable.js';

@injectable()
export class AddonRegistry {
  private readonly addons = new Map<string, Addon>();

  registerAddon(addon: Addon): Disposable {
    const id = addon.id;
    if (this.addons.has(id)) {
      throw new Error(`Addon with id '${id}' is already registered`);
    }

    this.addons.set(id, addon);
    return Disposable.create(() => {
      this.addons.delete(id);
    });
  }

  getAddons(): ReadonlyArray<Addon> {
    return Array.from(this.addons.values());
  }
}
