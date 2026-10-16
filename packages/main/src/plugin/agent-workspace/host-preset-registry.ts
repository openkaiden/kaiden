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

import type { HostPreset } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

import { Disposable } from '../types/disposable.js';

@injectable()
export class HostPresetRegistry {
  private readonly presets = new Map<string, HostPreset>();

  constructor(@inject(ApiSenderType) private readonly apiSender: ApiSenderType) {}

  registerHostPreset(preset: HostPreset): Disposable {
    if (this.presets.has(preset.id)) {
      throw new Error(`Host preset with id '${preset.id}' is already registered`);
    }

    this.presets.set(preset.id, preset);
    this.apiSender.send('host-preset-registry:updated');
    return Disposable.create(() => {
      this.presets.delete(preset.id);
      this.apiSender.send('host-preset-registry:updated');
    });
  }

  getHostPresets(): ReadonlyArray<HostPreset> {
    return Array.from(this.presets.values());
  }
}
