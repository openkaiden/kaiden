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

import { InversifyBinding } from '/@/inject/inversify-binding';
import { CatalogManager } from '/@/manager/catalog-manager';

export class AddonsCatalogExtension {
  #inversifyBinding: InversifyBinding | undefined;
  #catalogManager: CatalogManager | undefined;

  constructor(private readonly extensionContext: ExtensionContext) {}

  async activate(): Promise<void> {
    this.#inversifyBinding = new InversifyBinding(this.extensionContext);
    const container = await this.#inversifyBinding.initBindings();
    this.#catalogManager = container.get(CatalogManager);
    // loaded after activation so a slow network doesn't hold it up
    this.#catalogManager.init().catch((error: unknown) => console.error('Unable to load the addons catalog', error));
  }

  async deactivate(): Promise<void> {
    this.#catalogManager?.dispose();
    this.#catalogManager = undefined;
    await this.#inversifyBinding?.dispose();
    this.#inversifyBinding = undefined;
  }
}
