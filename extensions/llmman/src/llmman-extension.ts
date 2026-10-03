/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
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

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { configuration, type Disposable, type ExtensionContext, type Provider, provider } from '@openkaiden/api';

const CONFIGURATION_SECTION = 'llmman';
const ENDPOINT_KEY = 'endpoint';
export const LLMMAN_ENDPOINT_SETTING = `${CONFIGURATION_SECTION}.${ENDPOINT_KEY}`;
export const LLMMAN_DEFAULT_ENDPOINT = 'http://localhost:17434';

const ICON = './icon.png';
const POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class LlmmanExtension {
  #extensionContext: ExtensionContext;
  #currentModels: string[] = [];
  #currentEndpoint: string | undefined;
  #connectionDisposable: Disposable | undefined;
  #connectionIdCounter = 0;
  #refreshGeneration = 0;
  #interval: NodeJS.Timeout | undefined;
  #abortController: AbortController | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const abortController = new AbortController();
    this.#abortController = abortController;

    const llmmanProvider = provider.createProvider({
      name: 'llmman',
      status: 'unknown',
      id: 'llmman',
      images: { icon: ICON, logo: { dark: ICON, light: ICON } },
      links: [
        { title: 'Website', url: 'https://github.com/llmmanorg/llmman' },
        { title: 'Documentation', url: 'https://github.com/llmmanorg/llmman/tree/main/docs' },
      ],
    });
    this.#extensionContext.subscriptions.push(llmmanProvider);

    const logError = (error: unknown): void => console.error('Error updating llmman models and status:', error);
    const refresh = (): void => {
      if (abortController.signal.aborted) return;
      this.updateModelsAndStatus(llmmanProvider).catch(logError);
    };
    this.#extensionContext.subscriptions.push(
      configuration.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(LLMMAN_ENDPOINT_SETTING)) refresh();
      }),
    );

    await this.updateModelsAndStatus(llmmanProvider).catch(logError);
    if (abortController.signal.aborted) return;
    this.#interval = setInterval(refresh, POLL_INTERVAL_MS);
  }

  protected getEndpoint(): string {
    const configured = configuration.getConfiguration(CONFIGURATION_SECTION).get<string>(ENDPOINT_KEY)?.trim();
    let endpoint = configured?.length ? configured : LLMMAN_DEFAULT_ENDPOINT;
    while (endpoint.endsWith('/')) {
      endpoint = endpoint.slice(0, -1);
    }
    return endpoint;
  }

  protected getRequestTimeoutMs(): number {
    return REQUEST_TIMEOUT_MS;
  }

  protected async fetchModels(endpoint: string): Promise<string[]> {
    const signals = [AbortSignal.timeout(this.getRequestTimeoutMs())];
    if (this.#abortController) signals.push(this.#abortController.signal);

    const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.any(signals) });
    if (!res.ok) {
      throw new Error(`HTTP error, status: ${res.status}`);
    }
    const body: unknown = await res.json();
    const list = body !== null && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
    if (!Array.isArray(list)) return [];
    return list
      .map((model: unknown) => (model as { id?: unknown } | null)?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  protected async updateModelsAndStatus(llmmanProvider: Provider): Promise<void> {
    const generation = ++this.#refreshGeneration;
    const endpoint = this.getEndpoint();

    let models: string[] | undefined;
    try {
      models = await this.fetchModels(endpoint);
    } catch {
      models = undefined;
    }
    // superseded by a newer refresh or by deactivate()
    if (generation !== this.#refreshGeneration) return;

    if (!models) {
      llmmanProvider.updateStatus('stopped');
      this.disposeConnection();
      return;
    }

    llmmanProvider.updateStatus('started');
    const unchanged =
      endpoint === this.#currentEndpoint &&
      models.length === this.#currentModels.length &&
      models.every((name, i) => name === this.#currentModels[i]);
    if (unchanged) return;

    this.disposeConnection();
    if (models.length > 0) {
      // llmman serves an OpenAI-compatible API under /v1 and accepts any API key
      const baseURL = `${endpoint}/v1`;
      this.#connectionDisposable = llmmanProvider.registerInferenceProviderConnection({
        id: String(this.#connectionIdCounter++),
        name: 'llmman',
        type: 'local',
        llmMetadata: { name: 'openai' },
        endpoint: baseURL,
        sdk: createOpenAICompatible({ baseURL, name: 'llmman', apiKey: 'llmman' }),
        status: () => 'started',
        models: models.map(label => ({ label })),
        credentials: () => ({}),
      });
    }
    this.#currentModels = models;
    this.#currentEndpoint = endpoint;
  }

  protected disposeConnection(): void {
    this.#connectionDisposable?.dispose();
    this.#connectionDisposable = undefined;
    this.#currentModels = [];
    this.#currentEndpoint = undefined;
  }

  async deactivate(): Promise<void> {
    this.#refreshGeneration++;
    this.#abortController?.abort();
    this.#abortController = undefined;
    clearInterval(this.#interval);
    this.#interval = undefined;
    this.disposeConnection();
  }
}
