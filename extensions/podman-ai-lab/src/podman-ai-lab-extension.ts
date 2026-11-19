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

import { type ExtensionContext, provider } from '@openkaiden/api';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { InferenceModelManager } from '/@/manager/inference-model-manager';

export class PodmanAiLabExtension {
  private static readonly PROVIDER_ID = 'podman-ai-lab';

  #extensionContext: ExtensionContext;

  #inversifyBinding: InversifyBinding | undefined;
  #inferenceModelManager: InferenceModelManager | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const aiLabProvider = provider.createProvider({
      name: 'Podman AI Lab',
      status: 'unknown',
      id: PodmanAiLabExtension.PROVIDER_ID,
      images: {
        icon: './icon.png',
        logo: './icon.png',
      },
      links: [{ title: 'Website', url: 'https://developers.redhat.com/products/podman-desktop/podman-ai-lab' }],
    });
    this.#extensionContext.subscriptions.push(aiLabProvider);

    this.#inversifyBinding = new InversifyBinding(aiLabProvider);
    const container = await this.#inversifyBinding.initBindings();

    try {
      this.#inferenceModelManager = await container.getAsync(InferenceModelManager);
    } catch (err: unknown) {
      console.error('Error while creating the Podman AI Lab inference model manager', err);
      throw err;
    }

    await this.#inferenceModelManager.init();
  }

  async deactivate(): Promise<void> {
    this.#inferenceModelManager?.dispose();
    this.#inferenceModelManager = undefined;
    await this.#inversifyBinding?.dispose();
    this.#inversifyBinding = undefined;
  }
}
