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

import { AiLabDaemonClient } from '/@/helper/ai-lab-daemon-client';
import { AiLabPortResolver } from '/@/helper/ai-lab-port-resolver';
import { ContainerHostResolver } from '/@/helper/container-host-resolver';
import { PodmanAiLabProvider } from '/@/inject/symbol';

/**
 * Polls the AI Lab daemon and keeps one inference provider connection registered
 * with the models whose inference server is running.
 */
@injectable()
export class InferenceModelManager implements Disposable {
  private static readonly POLL_INTERVAL_MS = 30_000;

  @inject(PodmanAiLabProvider)
  private aiLabProvider: Provider;

  @inject(AiLabDaemonClient)
  private daemonClient: AiLabDaemonClient;

  @inject(AiLabPortResolver)
  private portResolver: AiLabPortResolver;

  @inject(ContainerHostResolver)
  private containerHostResolver: ContainerHostResolver;

  #currentModels: string[] = [];
  #currentPort: number | undefined;
  #daemonReachable: boolean | undefined;
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
    }, InferenceModelManager.POLL_INTERVAL_MS);
  }

  async #refresh(): Promise<void> {
    const signal = this.#abortController?.signal;
    if (signal?.aborted) return;

    // read the port once: the models, the endpoint and the SDK must all target the daemon that answered
    const port = await this.portResolver.getPort();
    if (signal?.aborted) return;
    const baseURL = this.daemonClient.getBaseURL(port);

    let models: string[];
    try {
      models = await this.daemonClient.listRunningModels(port, signal);
    } catch (err: unknown) {
      // aborted on dispose: nothing to update
      if (signal?.aborted) return;
      // log only the transition, the daemon is not running for most users
      if (this.#daemonReachable !== false) {
        console.debug(`Podman AI Lab daemon at ${baseURL} is unreachable:`, err);
      }
      this.#daemonReachable = false;
      this.aiLabProvider.updateStatus('stopped');
      this.#unregisterConnection();
      this.#currentModels = [];
      this.#currentPort = undefined;
      return;
    }

    if (signal?.aborted) return;

    this.#daemonReachable = true;
    this.aiLabProvider.updateStatus('started');

    const sortedModels = models.toSorted((a, b) => a.localeCompare(b));
    const modelsChanged =
      port !== this.#currentPort ||
      sortedModels.length !== this.#currentModels.length ||
      sortedModels.some((name, i) => name !== this.#currentModels[i]);
    if (!modelsChanged) return;

    this.#unregisterConnection();
    this.#currentModels = sortedModels;
    this.#currentPort = port;
    if (sortedModels.length === 0) return;

    const host = this.containerHostResolver.getReachableHost();
    this.#connectionDisposable = this.aiLabProvider.registerInferenceProviderConnection({
      id: randomUUID(),
      name: 'podman-ai-lab',
      type: 'local',
      llmMetadata: { name: 'ollama' },
      // agents consume the OpenAI-compatible layer served by the AI Lab daemon under /v1
      endpoint: `http://${host}:${port}/v1`,
      sdk: createOllama({ baseURL: `${baseURL}/api` }),
      status() {
        return 'started';
      },
      models: sortedModels.map(name => ({ label: name })),
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
    this.#currentPort = undefined;
    this.#daemonReachable = undefined;
  }
}
