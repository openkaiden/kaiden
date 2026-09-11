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

import type { Extension, ExtensionContext } from '@openkaiden/api';
import { extensions } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { SemanticRouterContainerManager } from '/@/manager/semantic-router-container-manager';

import { VllmSemanticRouterExtension } from './vllm-semantic-router-extension';

vi.mock(import('/@/manager/semantic-router-container-manager'));

describe('VllmSemanticRouterExtension', () => {
  let extensionContext: ExtensionContext;
  let extension: VllmSemanticRouterExtension;

  beforeEach(() => {
    vi.resetAllMocks();
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    extension = new VllmSemanticRouterExtension(extensionContext);

    const extensionData = {
      exports: {} as unknown as ContainerExtensionAPI,
    } as unknown as Extension<ContainerExtensionAPI>;
    vi.mocked(extensions.getExtension).mockReturnValue(extensionData);
  });

  test('activate succeeds and initializes the manager', async () => {
    await extension.activate();

    expect(SemanticRouterContainerManager.prototype.init).toHaveBeenCalled();
  });

  test('activate fails when container extension is not installed', async () => {
    vi.mocked(extensions.getExtension).mockReturnValue(undefined);

    await expect(extension.activate()).rejects.toThrow('Mandatory extension kaiden.container is not installed');
  });

  test('activate fails when container extension has no exports', async () => {
    const extensionData = { exports: undefined } as unknown as Extension<ContainerExtensionAPI>;
    vi.mocked(extensions.getExtension).mockReturnValue(extensionData);

    await expect(extension.activate()).rejects.toThrow(
      'Missing exports of API in container extension kaiden.container',
    );
  });

  test('deactivate disposes the manager', async () => {
    await extension.activate();
    await extension.deactivate();

    expect(SemanticRouterContainerManager.prototype.dispose).toHaveBeenCalled();
  });
});
