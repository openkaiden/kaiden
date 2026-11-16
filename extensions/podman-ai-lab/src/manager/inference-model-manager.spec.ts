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

import type { Provider } from '@openkaiden/api';
import { Container } from 'inversify';
import type { OllamaProvider } from 'ollama-ai-provider-v2';
import { createOllama } from 'ollama-ai-provider-v2';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AiLabDaemonClient } from '/@/helper/ai-lab-daemon-client';
import { ContainerHostResolver } from '/@/helper/container-host-resolver';
import { PodmanAiLabProviderSymbol } from '/@/inject/symbol';

import { InferenceModelManager } from './inference-model-manager';

vi.mock(import('node:crypto'));
vi.mock(import('ollama-ai-provider-v2'));
vi.mock(import('/@/helper/ai-lab-daemon-client'));
vi.mock(import('/@/helper/container-host-resolver'));

describe('InferenceModelManager', () => {
  let aiLabProvider: Provider;
  let manager: InferenceModelManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();

    aiLabProvider = {
      updateStatus: vi.fn(),
      registerInferenceProviderConnection: vi.fn(),
    } as unknown as Provider;
    vi.mocked(randomUUID).mockReturnValue('00000000-0000-0000-0000-000000000000');
    vi.mocked(ContainerHostResolver.prototype.getReachableHost).mockReturnValue('localhost');

    const container = new Container();
    container.bind(InferenceModelManager).toSelf();
    container.bind(AiLabDaemonClient).toConstantValue(new AiLabDaemonClient());
    container.bind(ContainerHostResolver).toConstantValue(new ContainerHostResolver());
    container.bind(PodmanAiLabProviderSymbol).toConstantValue(aiLabProvider);
    manager = await container.getAsync(InferenceModelManager);
  });

  test('should register a connection with the running models', async () => {
    const sdk = {} as OllamaProvider;
    vi.mocked(createOllama).mockReturnValue(sdk);
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['granite3']);

    await manager.init();

    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(aiLabProvider.updateStatus).toHaveBeenCalledWith('started');
    expect(createOllama).toHaveBeenCalledWith({ baseURL: 'http://localhost:10434/api' });
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-0000-0000-000000000000',
        name: 'podman-ai-lab',
        type: 'local',
        llmMetadata: { name: 'ollama' },
        endpoint: 'http://localhost:10434/v1',
        sdk,
        models: [{ label: 'granite3' }],
      }),
    );
  });

  test('should use the container reachable host in the endpoint', async () => {
    vi.mocked(ContainerHostResolver.prototype.getReachableHost).mockReturnValue('192.168.1.100');
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['m1']);

    await manager.init();

    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://192.168.1.100:10434/v1' }),
    );
  });

  test('should set status to stopped when the daemon is unreachable', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockRejectedValue(new Error('fail'));

    await manager.init();

    expect(aiLabProvider.updateStatus).toHaveBeenCalledWith('stopped');
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should not register a connection when no model is running', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue([]);

    await manager.init();

    expect(aiLabProvider.updateStatus).toHaveBeenCalledWith('started');
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should not re-register the connection when the models are unchanged', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels)
      .mockResolvedValueOnce(['m1', 'm2'])
      .mockResolvedValueOnce(['m2', 'm1']);

    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledTimes(2);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
  });

  test('should replace the connection when the models change', async () => {
    const firstDispose = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValueOnce({ dispose: firstDispose });
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels)
      .mockResolvedValueOnce(['m1'])
      .mockResolvedValueOnce(['m1', 'm2']);

    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(firstDispose).toHaveBeenCalled();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ models: [{ label: 'm1' }, { label: 'm2' }] }),
    );
  });

  test('should dispose the connection when the daemon stops', async () => {
    const dispose = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValueOnce({ dispose });
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels)
      .mockResolvedValueOnce(['m1'])
      .mockRejectedValueOnce(new Error('fail'));

    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(dispose).toHaveBeenCalled();
    expect(aiLabProvider.updateStatus).toHaveBeenLastCalledWith('stopped');
  });

  test('should dispose the connection and stop polling on dispose', async () => {
    const dispose = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValueOnce({ dispose });
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['m1']);

    await manager.init();
    manager.dispose();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(dispose).toHaveBeenCalled();
    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledTimes(1);
  });

  test('should ignore a response received after dispose', async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockReturnValue(promise);

    const init = manager.init();
    manager.dispose();
    resolve(['m1']);
    await init;

    expect(aiLabProvider.updateStatus).not.toHaveBeenCalled();
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should not report stopped when the request is aborted by dispose', async () => {
    const { promise, reject } = Promise.withResolvers<string[]>();
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockReturnValue(promise);

    const init = manager.init();
    manager.dispose();
    reject(new DOMException('aborted', 'AbortError'));
    await init;

    expect(aiLabProvider.updateStatus).not.toHaveBeenCalled();
  });
});
