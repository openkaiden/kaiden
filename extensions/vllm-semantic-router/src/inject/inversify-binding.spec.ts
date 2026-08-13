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

import type { ExtensionContext, Provider } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { ContainerFinder } from '/@/helper/container-finder';
import { EnvoyConfigGenerator } from '/@/helper/envoy-config-generator';
import { ImageHelper } from '/@/helper/image-helper';
import { MountHelper } from '/@/helper/mount-helper';
import { NetworkHelper } from '/@/helper/network-helper';
import { SemanticRouterConfigParser } from '/@/helper/semantic-router-config-parser';
import { SemanticRouterContainerManager } from '/@/manager/semantic-router-container-manager';

import { InversifyBinding } from './inversify-binding';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, VllmSemanticRouterProvider } from './symbol';

const containerExtensionAPIMock = {} as ContainerExtensionAPI;
const extensionContextMock = {} as ExtensionContext;
const providerMock = {} as Provider;

let inversifyBinding: InversifyBinding;

describe('InversifyBinding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inversifyBinding = new InversifyBinding(providerMock, containerExtensionAPIMock, extensionContextMock);
  });

  test('binds the extension constants', async () => {
    const container = await inversifyBinding.initBindings();

    expect(container.get(ExtensionContextSymbol)).toBe(extensionContextMock);
    expect(container.get(ContainerExtensionAPISymbol)).toBe(containerExtensionAPIMock);
    expect(container.get(VllmSemanticRouterProvider)).toBe(providerMock);
  });

  test.each([
    ['ContainerFinder', ContainerFinder],
    ['NetworkHelper', NetworkHelper],
    ['SemanticRouterConfigParser', SemanticRouterConfigParser],
    ['EnvoyConfigGenerator', EnvoyConfigGenerator],
    ['ImageHelper', ImageHelper],
    ['MountHelper', MountHelper],
    ['SemanticRouterContainerManager', SemanticRouterContainerManager],
  ])('resolves %s as a singleton', async (_name, serviceIdentifier) => {
    const container = await inversifyBinding.initBindings();

    const first = await container.getAsync(serviceIdentifier);
    const second = await container.getAsync(serviceIdentifier);
    expect(first).toBe(second);

    expect(first).toBeInstanceOf(serviceIdentifier);
  });

  test.each([
    ['ContainerFinder', ContainerFinder],
    ['NetworkHelper', NetworkHelper],
    ['SemanticRouterConfigParser', SemanticRouterConfigParser],
    ['EnvoyConfigGenerator', EnvoyConfigGenerator],
    ['ImageHelper', ImageHelper],
    ['MountHelper', MountHelper],
    ['SemanticRouterContainerManager', SemanticRouterContainerManager],
  ])('dispose unbinds everything', async (_name, serviceIdentifier) => {
    const container = await inversifyBinding.initBindings();
    assert(container.isBound(serviceIdentifier));

    await inversifyBinding.dispose();

    expect(container.isBound(serviceIdentifier)).toBe(false);
  });

  test('dispose before initBindings does nothing', async () => {
    await expect(inversifyBinding.dispose()).resolves.toBeUndefined();
  });
});
