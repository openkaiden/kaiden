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

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IConfigurationRegistry } from '/@api/configuration/models.js';

import { AcpInit } from './acp-init.js';

let acpInit: AcpInit;
let configurationRegistry: IConfigurationRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  configurationRegistry = {
    registerConfigurations: vi.fn(),
  } as unknown as IConfigurationRegistry;
  acpInit = new AcpInit(configurationRegistry);
});

describe('init', () => {
  test('registers acp.maxAttachmentFileSize configuration', () => {
    acpInit.init();

    expect(configurationRegistry.registerConfigurations).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'preferences.acp',
        properties: expect.objectContaining({
          'acp.maxAttachmentFileSize': expect.objectContaining({
            type: 'number',
            default: 20,
            minimum: 1,
            maximum: 100,
          }),
        }),
      }),
    ]);
  });
});
