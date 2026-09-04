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
import { Container } from 'inversify';

import { helpersModule } from '/@/helper/_module';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, VllmSemanticRouterProvider } from '/@/inject/symbol';
import { managersModule } from '/@/manager/_module';

export class InversifyBinding {
  #container: Container | undefined;

  readonly #provider: Provider;
  readonly #containerExtensionAPI: ContainerExtensionAPI;
  readonly #extensionContext: ExtensionContext;

  constructor(provider: Provider, containerExtensionAPI: ContainerExtensionAPI, extensionContext: ExtensionContext) {
    this.#provider = provider;
    this.#containerExtensionAPI = containerExtensionAPI;
    this.#extensionContext = extensionContext;
  }

  public async initBindings(): Promise<Container> {
    this.#container = new Container();

    this.#container.bind(ExtensionContextSymbol).toConstantValue(this.#extensionContext);
    this.#container.bind(ContainerExtensionAPISymbol).toConstantValue(this.#containerExtensionAPI);
    this.#container.bind(VllmSemanticRouterProvider).toConstantValue(this.#provider);

    await this.#container.load(helpersModule);
    await this.#container.load(managersModule);

    return this.#container;
  }

  async dispose(): Promise<void> {
    if (this.#container) {
      await this.#container.unbindAll();
    }
  }
}
