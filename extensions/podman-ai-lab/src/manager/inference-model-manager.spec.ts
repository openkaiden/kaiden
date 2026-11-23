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
import { AiLabPortResolver } from '/@/helper/ai-lab-port-resolver';
import { ContainerHostResolver } from '/@/helper/container-host-resolver';
import { PodmanAiLabProvider } from '/@/inject/symbol';

import { InferenceModelManager } from './inference-model-manager';

vi.mock(import('node:crypto'));
vi.mock(import('ollama-ai-provider-v2'));
vi.mock(import('/@/helper/ai-lab-daemon-client'));
vi.mock(import('/@/helper/ai-lab-port-resolver'));
vi.mock(import('/@/helper/container-host-resolver'));

describe('InferenceModelManager', () => {
  let aiLabProvider: Pick<Provider, 'updateStatus' | 'registerInferenceProviderConnection'>;
  let manager: InferenceModelManager;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();

    aiLabProvider = {
      updateStatus: vi.fn(),
      registerInferenceProviderConnection: vi.fn(),
    };
    vi.mocked(randomUUID).mockReturnValue('00000000-0000-0000-0000-000000000000');
    vi.mocked(ContainerHostResolver.prototype.getReachableHost).mockReturnValue('localhost');
    vi.mocked(AiLabPortResolver.prototype.getPort).mockResolvedValue(10434);
    vi.mocked(AiLabDaemonClient.prototype.getBaseURL).mockImplementation(port => `http://localhost:${port}`);
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const container = new Container();
    container.bind(InferenceModelManager).toSelf();
    container.bind(AiLabDaemonClient).toConstantValue(new AiLabDaemonClient());
    container.bind(AiLabPortResolver).toConstantValue(new AiLabPortResolver());
    container.bind(ContainerHostResolver).toConstantValue(new ContainerHostResolver());
    container.bind(PodmanAiLabProvider).toConstantValue(aiLabProvider);
    manager = await container.getAsync(InferenceModelManager);
  });

  test('should register a connection with the running models', async () => {
    const sdk = {} as OllamaProvider;
    vi.mocked(createOllama).mockReturnValue(sdk);
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['granite3']);

    await manager.init();

    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledWith(10434, expect.any(AbortSignal));
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

  test('should use the port of the AI Lab daemon for the request, the SDK and the endpoint', async () => {
    vi.mocked(AiLabPortResolver.prototype.getPort).mockResolvedValue(12345);
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['m1']);

    await manager.init();

    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledWith(12345, expect.any(AbortSignal));
    expect(createOllama).toHaveBeenCalledWith({ baseURL: 'http://localhost:12345/api' });
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:12345/v1' }),
    );
  });

  test('should read the port once per refresh', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['m1']);

    await manager.init();

    expect(AiLabPortResolver.prototype.getPort).toHaveBeenCalledTimes(1);
  });

  test('should target the same port for the models and the connection when the port changes during the request', async () => {
    vi.mocked(AiLabPortResolver.prototype.getPort).mockResolvedValueOnce(10434).mockResolvedValue(12345);
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['m1']);

    await manager.init();

    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledWith(10434, expect.any(AbortSignal));
    expect(createOllama).toHaveBeenCalledWith({ baseURL: 'http://localhost:10434/api' });
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:10434/v1' }),
    );
  });

  test('should ignore the port read after dispose', async () => {
    const { promise, resolve } = Promise.withResolvers<number>();
    vi.mocked(AiLabPortResolver.prototype.getPort).mockReturnValue(promise);

    const init = manager.init();
    manager.dispose();
    resolve(10434);
    await init;

    expect(AiLabDaemonClient.prototype.listRunningModels).not.toHaveBeenCalled();
    expect(aiLabProvider.updateStatus).not.toHaveBeenCalled();
  });

  test('should replace the connection when the port changes and the models do not', async () => {
    const firstDispose = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValueOnce({ dispose: firstDispose });
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['m1']);

    await manager.init();
    vi.mocked(AiLabPortResolver.prototype.getPort).mockResolvedValue(12345);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(firstDispose).toHaveBeenCalled();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:12345/v1' }),
    );
  });

  test('should register the models sorted by name', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockResolvedValue(['b-model', 'a-model']);

    await manager.init();

    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ models: [{ label: 'a-model' }, { label: 'b-model' }] }),
    );
  });

  test('should log the unreachable daemon once until it is reachable again', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels)
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(['m1'])
      .mockRejectedValueOnce(new Error('down again'));

    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
    expect(consoleDebugSpy).toHaveBeenCalledWith(
      'Podman AI Lab daemon at http://localhost:10434 is unreachable:',
      expect.objectContaining({ message: 'down' }),
    );

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(consoleDebugSpy).toHaveBeenCalledTimes(2);
    expect(consoleDebugSpy).toHaveBeenLastCalledWith(
      'Podman AI Lab daemon at http://localhost:10434 is unreachable:',
      expect.objectContaining({ message: 'down again' }),
    );
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
    // let the port be read so that the request is pending
    await vi.advanceTimersByTimeAsync(0);
    manager.dispose();
    resolve(['m1']);
    await init;

    expect(aiLabProvider.updateStatus).not.toHaveBeenCalled();
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should not start polling when disposed during the first refresh', async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockReturnValue(promise);

    const init = manager.init();
    // let the port be read so that the request is pending
    await vi.advanceTimersByTimeAsync(0);
    manager.dispose();
    resolve(['m1']);
    await init;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(AiLabDaemonClient.prototype.listRunningModels).toHaveBeenCalledTimes(1);
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should keep the same connection id when the connection is replaced', async () => {
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels)
      .mockResolvedValueOnce(['m1'])
      .mockResolvedValueOnce(['m1', 'm2']);

    await manager.init();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: '00000000-0000-0000-0000-000000000000' }),
    );
  });

  test('should not report stopped when the request is aborted by dispose', async () => {
    const { promise, reject } = Promise.withResolvers<string[]>();
    vi.mocked(AiLabDaemonClient.prototype.listRunningModels).mockReturnValue(promise);

    const init = manager.init();
    // let the port be read so that the request is pending
    await vi.advanceTimersByTimeAsync(0);
    manager.dispose();
    reject(new DOMException('aborted', 'AbortError'));
    await init;

    expect(aiLabProvider.updateStatus).not.toHaveBeenCalled();
  });
});
