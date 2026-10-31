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

import type { ExtensionContext } from '@openkaiden/api';
import { extensions, provider } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import type { Container } from 'inversify';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { SemanticRouterContainerManager } from '/@/manager/semantic-router-container-manager';

const CONTAINER_EXTENSION_ID = 'kaiden.container';

export class VllmSemanticRouterExtension {
  #extensionContext: ExtensionContext;
  #inversifyBinding: InversifyBinding | undefined;
  #container: Container | undefined;
  #manager: SemanticRouterContainerManager | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const containerExtension = extensions.getExtension<ContainerExtensionAPI>(CONTAINER_EXTENSION_ID);
    if (!containerExtension) {
      throw new Error(`Mandatory extension ${CONTAINER_EXTENSION_ID} is not installed`);
    }
    const containerExtensionAPI = containerExtension.exports;
    if (!containerExtensionAPI) {
      throw new Error(`Missing exports of API in container extension ${CONTAINER_EXTENSION_ID}`);
    }

    const vllmProvider = provider.createProvider({
      name: 'vLLM Semantic Router',
      status: 'unknown',
      id: 'vllm-semantic-router',
      images: {
        icon: 'icon.png',
        logo: 'icon.png',
      },
    });

    this.#inversifyBinding = new InversifyBinding(vllmProvider, containerExtensionAPI, this.#extensionContext);
    this.#container = await this.#inversifyBinding.initBindings();

    this.#manager = await this.#container.getAsync(SemanticRouterContainerManager);
    await this.#manager.init();
  }

  async deactivate(): Promise<void> {
    this.#manager?.dispose();
    this.#manager = undefined;
    await this.#inversifyBinding?.dispose();
  }
}
