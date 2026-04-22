/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Disposable, Provider } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import type { ModelInfo } from '/@/api/model-info';
import { ModelsHandler } from '/@/handler/models-handler';
import { RamalamaProvider } from '/@/inject/symbol';

// class is responsible to manage the inference models available
@injectable()
export class InferenceModelManager {
  @inject(ModelsHandler)
  private modelsHandler: ModelsHandler;

  @inject(RamalamaProvider)
  private ramaLamaProvider: Provider;

  #modelsDisposable: Disposable[] = [];

  async init(): Promise<void> {
    this.modelsHandler.onModelsChanged(async models => {
      await this.refreshRegistrationOfModels(models);
    });

    await this.modelsHandler.init();
  }

  async refreshRegistrationOfModels(models: readonly ModelInfo[]): Promise<void> {
    // dispose previous registrations
    for (const disposable of this.#modelsDisposable) {
      disposable.dispose();
    }
    this.#modelsDisposable = [];

    for (const modelinfo of models) {
      const sdk = createOpenAICompatible({
        baseURL: `http://localhost:${modelinfo.port}`,
        name: `RamaLama/${modelinfo.port}`,
      });
      const disposable = this.ramaLamaProvider.registerInferenceProviderConnection({
        name: `port/${modelinfo.port}`,
        type: 'local',
        providerName: 'openai',
        endpoint: `http://localhost:${modelinfo.port}`,
        sdk,
        status() {
          return 'started';
        },
        models: [{ label: modelinfo.name }],
        credentials() {
          return {};
        },
      });
      this.#modelsDisposable.push(disposable);
    }
  }

  dispose(): void {
    for (const disposable of this.#modelsDisposable) {
      disposable.dispose();
    }
    this.#modelsDisposable = [];
  }
}
