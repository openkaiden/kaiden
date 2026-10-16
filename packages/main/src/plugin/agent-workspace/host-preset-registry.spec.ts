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
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

import { HostPresetRegistry } from './host-preset-registry.js';

const apiSender: ApiSenderType = { send: vi.fn(), receive: vi.fn() };

let registry: HostPresetRegistry;

describe('HostPresetRegistry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    registry = new HostPresetRegistry(apiSender);
  });

  test('registers and returns host presets', () => {
    const preset: HostPreset = { id: 'registries', name: 'Registries', hosts: [{ hostname: 'registry.npmjs.org' }] };
    registry.registerHostPreset(preset);
    expect(registry.getHostPresets()).toStrictEqual([preset]);
  });

  test('registers and send event', () => {
    const preset: HostPreset = { id: 'registries', name: 'Registries', hosts: [{ hostname: 'registry.npmjs.org' }] };
    registry.registerHostPreset(preset);
    expect(apiSender.send).toHaveBeenCalledWith('host-preset-registry:updated');
  });

  test('rejects a duplicate preset id', () => {
    const preset: HostPreset = { id: 'registries', name: 'Registries', hosts: [{ hostname: 'registry.npmjs.org' }] };
    registry.registerHostPreset(preset);
    expect(() => registry.registerHostPreset(preset)).toThrow(`Host preset with id 'registries' is already registered`);
  });

  test('removes a preset when its registration is disposed', () => {
    const preset: HostPreset = { id: 'registries', name: 'Registries', hosts: [{ hostname: 'registry.npmjs.org' }] };
    const registration = registry.registerHostPreset(preset);
    registration.dispose();
    expect(registry.getHostPresets()).toStrictEqual([]);
  });
});
