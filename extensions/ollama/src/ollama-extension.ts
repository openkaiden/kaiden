/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
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

import { type Disposable, type ExtensionContext, type Provider, provider } from '@openkaiden/api';
import { createOllama } from 'ollama-ai-provider-v2';

export class OllamaExtension {
  #extensionContext: ExtensionContext;
  #currentModels: string[] = [];
  #connectionDisposable: Disposable | undefined;
  #interval: NodeJS.Timeout | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const ollamaProvider = provider.createProvider({
      name: 'Ollama',
      status: 'unknown',
      id: 'ollama',
      images: {
        icon: './icon.png',
        logo: {
          dark: './icon.png',
          light: './icon.png',
        },
      },
    });
    this.#extensionContext.subscriptions.push(ollamaProvider);

    await this.updateModelsAndStatus(ollamaProvider);
    this.#interval = setInterval(() => {
      this.updateModelsAndStatus(ollamaProvider).catch((error: unknown) => {
        console.error('Error updating Ollama models and status:', error);
      });
    }, 30000);
  }

  protected async updateModelsAndStatus(ollamaProvider: Provider): Promise<void> {
    let models: Array<{ name: string }> = [];
    let running = true;
    try {
      const res = await fetch('http://localhost:11434/api/tags');
      if (!res.ok) {
        throw new Error(`HTTP error, status: ${res.status}`);
      }
      const data = await res.json();
      models =
        data !== null && typeof data === 'object' && 'models' in data
          ? Array.isArray(data.models)
            ? data.models
            : []
          : [];
    } catch (_err: unknown) {
      running = false;
      models = [];
    }

    // Update provider status
    if (!running) {
      ollamaProvider.updateStatus('stopped');
      // deregister previous connection if exists
      if (this.#connectionDisposable) {
        this.#connectionDisposable.dispose();
        this.#connectionDisposable = undefined;
      }
      this.#currentModels = [];
      return;
    }

    ollamaProvider.updateStatus('started');
    const newModelNames = models.map(m => m.name).sort((a, b) => a.localeCompare(b));
    const oldModelNames = this.#currentModels.slice().sort((a, b) => a.localeCompare(b));
    const modelsChanged =
      newModelNames.length !== oldModelNames.length || newModelNames.some((v, i) => v !== oldModelNames[i]);

    if (modelsChanged) {
      // Unregister previous connection if exists
      if (this.#connectionDisposable) {
        this.#connectionDisposable.dispose();
        this.#connectionDisposable = undefined;
      }
      this.#currentModels = newModelNames;
      if (newModelNames.length > 0) {
        const sdk = createOllama();
        const disposable = ollamaProvider.registerInferenceProviderConnection({
          name: 'ollama',
          type: 'local',
          providerName: 'ollama',
          endpoint: 'http://localhost:11434/v1',
          sdk,
          status() {
            return 'started';
          },
          models: models.map(model => ({ label: model.name })),
          credentials() {
            return {};
          },
        });
        this.#connectionDisposable = disposable;
        this.#extensionContext.subscriptions.push(disposable);
      }
    }
  }

  async deactivate(): Promise<void> {
    clearInterval(this.#interval);
    this.#currentModels = [];
  }
}
