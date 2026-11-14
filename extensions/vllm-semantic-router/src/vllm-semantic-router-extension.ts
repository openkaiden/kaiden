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
import { extensions, provider } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import type { Container } from 'inversify';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { SemanticRouterContainerManager } from '/@/manager/semantic-router-container-manager';

export class VllmSemanticRouterExtension {
  private static readonly CONTAINER_EXTENSION_ID = 'kaiden.container';

  #extensionContext: ExtensionContext;
  #inversifyBinding: InversifyBinding | undefined;
  #container: Container | undefined;
  #manager: SemanticRouterContainerManager | undefined;
  #provider: Provider | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const containerExtension = extensions.getExtension<ContainerExtensionAPI>(
      VllmSemanticRouterExtension.CONTAINER_EXTENSION_ID,
    );
    if (!containerExtension) {
      throw new Error(`Mandatory extension ${VllmSemanticRouterExtension.CONTAINER_EXTENSION_ID} is not installed`);
    }
    const containerExtensionAPI = containerExtension.exports;
    if (!containerExtensionAPI) {
      throw new Error(
        `Missing exports of API in container extension ${VllmSemanticRouterExtension.CONTAINER_EXTENSION_ID}`,
      );
    }

    this.#provider = provider.createProvider({
      name: 'vLLM Semantic Router',
      status: 'unknown',
      id: 'vllm-semantic-router',
      images: {
        icon: 'icon.png',
        logo: 'icon.png',
      },
    });

    this.#inversifyBinding = new InversifyBinding(this.#provider, containerExtensionAPI, this.#extensionContext);
    this.#container = await this.#inversifyBinding.initBindings();

    this.#manager = await this.#container.getAsync(SemanticRouterContainerManager);
    await this.#manager.init();
  }

  async deactivate(): Promise<void> {
    this.#manager?.dispose();
    this.#manager = undefined;
    await this.#inversifyBinding?.dispose();
    // dispose the provider last: the manager unregisters its connections from it first
    this.#provider?.dispose();
    this.#provider = undefined;
  }
}
