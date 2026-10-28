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

import { networkInterfaces } from 'node:os';

import { type Disposable, env, type ExtensionContext, type Provider, provider } from '@openkaiden/api';
import { createOllama } from 'ollama-ai-provider-v2';

const AI_LAB_API_PORT = 10434;
const POLL_INTERVAL_MS = 30_000;

function getContainerReachableHost(): string {
  if (env.isWindows) {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (!entry.internal) {
          return entry.family === 'IPv6' ? `[${entry.address}]` : entry.address;
        }
      }
    }
  }
  return 'localhost';
}

export class PodmanAiLabExtension {
  #extensionContext: ExtensionContext;
  #currentModels: string[] = [];
  #connectionDisposable: Disposable | undefined;
  #connectionIdCounter = 0;
  #interval: NodeJS.Timeout | undefined;
  #abortController: AbortController | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    this.#abortController = new AbortController();

    const aiLabProvider = provider.createProvider({
      name: 'Podman AI Lab',
      status: 'unknown',
      id: 'podman-ai-lab',
      images: {
        icon: './icon.png',
        logo: './icon.png',
      },
      links: [{ title: 'Website', url: 'https://developers.redhat.com/products/podman-desktop/podman-ai-lab' }],
    });
    this.#extensionContext.subscriptions.push(aiLabProvider);

    await this.updateModelsAndStatus(aiLabProvider);
    this.#interval = setInterval(() => {
      this.updateModelsAndStatus(aiLabProvider).catch((error: unknown) => {
        console.error('Error updating Podman AI Lab models and status:', error);
      });
    }, POLL_INTERVAL_MS);
  }

  protected async updateModelsAndStatus(aiLabProvider: Provider): Promise<void> {
    const signal = this.#abortController?.signal;
    if (signal?.aborted) return;

    let models: Array<{ name: string }> = [];
    let running = true;
    try {
      const res = await fetch(`http://localhost:${AI_LAB_API_PORT}/api/ps`, { signal });
      if (!res.ok) {
        throw new Error(`HTTP error, status: ${res.status}`);
      }
      const data: unknown = await res.json();
      models =
        data !== null && typeof data === 'object' && 'models' in data
          ? Array.isArray(data.models)
            ? (data.models as Array<{ name: string }>)
            : []
          : [];
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      running = false;
      models = [];
    }

    if (signal?.aborted) return;

    if (!running) {
      aiLabProvider.updateStatus('stopped');
      if (this.#connectionDisposable) {
        this.#connectionDisposable.dispose();
        this.#connectionDisposable = undefined;
      }
      this.#currentModels = [];
      return;
    }

    aiLabProvider.updateStatus('started');
    const newModelNames = models.map(m => m.name).sort((a, b) => a.localeCompare(b));
    const oldModelNames = this.#currentModels.slice().sort((a, b) => a.localeCompare(b));
    const modelsChanged =
      newModelNames.length !== oldModelNames.length || newModelNames.some((v, i) => v !== oldModelNames[i]);

    if (modelsChanged) {
      if (this.#connectionDisposable) {
        this.#connectionDisposable.dispose();
        this.#connectionDisposable = undefined;
      }
      this.#currentModels = newModelNames;
      if (newModelNames.length > 0) {
        const host = getContainerReachableHost();
        const sdk = createOllama({ baseURL: `http://localhost:${AI_LAB_API_PORT}/api` });
        const disposable = aiLabProvider.registerInferenceProviderConnection({
          id: String(this.#connectionIdCounter++),
          name: 'podman-ai-lab',
          type: 'local',
          llmMetadata: { name: 'ollama' },
          endpoint: `http://${host}:${AI_LAB_API_PORT}`,
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
    this.#abortController?.abort();
    this.#abortController = undefined;
    clearInterval(this.#interval);
    if (this.#connectionDisposable) {
      this.#connectionDisposable.dispose();
      this.#connectionDisposable = undefined;
    }
    this.#currentModels = [];
  }
}
