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

import { randomUUID } from 'node:crypto';

import type { Disposable, Provider } from '@openkaiden/api';
import { inject, injectable } from 'inversify';
import { createOllama } from 'ollama-ai-provider-v2';

import { AI_LAB_API_PORT, AI_LAB_DAEMON_URL, AiLabDaemonClient } from '/@/helper/ai-lab-daemon-client';
import { ContainerHostResolver } from '/@/helper/container-host-resolver';
import { PodmanAiLabProviderSymbol } from '/@/inject/symbol';

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls the AI Lab daemon and keeps one inference provider connection registered
 * with the models whose inference server is running.
 */
@injectable()
export class InferenceModelManager implements Disposable {
  @inject(PodmanAiLabProviderSymbol)
  private aiLabProvider: Provider;

  @inject(AiLabDaemonClient)
  private daemonClient: AiLabDaemonClient;

  @inject(ContainerHostResolver)
  private containerHostResolver: ContainerHostResolver;

  #currentModels: string[] = [];
  #connectionDisposable: Disposable | undefined;
  #interval: NodeJS.Timeout | undefined;
  #abortController: AbortController | undefined;

  async init(): Promise<void> {
    this.#abortController = new AbortController();
    await this.#refresh();
    this.#interval = setInterval(() => {
      this.#refresh().catch((error: unknown) => {
        console.error('Error updating Podman AI Lab models and status:', error);
      });
    }, POLL_INTERVAL_MS);
  }

  async #refresh(): Promise<void> {
    const signal = this.#abortController?.signal;
    if (signal?.aborted) return;

    let models: string[];
    try {
      models = await this.daemonClient.listRunningModels(signal);
    } catch (err: unknown) {
      // aborted on dispose: nothing to update
      if (signal?.aborted) return;
      console.debug('Podman AI Lab daemon unreachable:', err);
      this.aiLabProvider.updateStatus('stopped');
      this.#unregisterConnection();
      this.#currentModels = [];
      return;
    }

    if (signal?.aborted) return;

    this.aiLabProvider.updateStatus('started');

    const sortedModels = models.toSorted((a, b) => a.localeCompare(b));
    const modelsChanged =
      sortedModels.length !== this.#currentModels.length ||
      sortedModels.some((name, i) => name !== this.#currentModels[i]);
    if (!modelsChanged) return;

    this.#unregisterConnection();
    this.#currentModels = sortedModels;
    if (models.length === 0) return;

    const host = this.containerHostResolver.getReachableHost();
    this.#connectionDisposable = this.aiLabProvider.registerInferenceProviderConnection({
      id: randomUUID(),
      name: 'podman-ai-lab',
      type: 'local',
      llmMetadata: { name: 'ollama' },
      // agents consume the OpenAI-compatible layer served by the AI Lab daemon under /v1
      endpoint: `http://${host}:${AI_LAB_API_PORT}/v1`,
      sdk: createOllama({ baseURL: `${AI_LAB_DAEMON_URL}/api` }),
      status() {
        return 'started';
      },
      models: models.map(name => ({ label: name })),
      credentials() {
        return {};
      },
    });
  }

  #unregisterConnection(): void {
    this.#connectionDisposable?.dispose();
    this.#connectionDisposable = undefined;
  }

  dispose(): void {
    this.#abortController?.abort();
    this.#abortController = undefined;
    clearInterval(this.#interval);
    this.#interval = undefined;
    this.#unregisterConnection();
    this.#currentModels = [];
  }
}
