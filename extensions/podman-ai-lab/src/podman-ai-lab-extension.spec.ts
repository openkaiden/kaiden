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
import type { NetworkInterfaceInfo } from 'node:os';
import { networkInterfaces } from 'node:os';

import type { ExtensionContext, Provider } from '@openkaiden/api';
import { env, provider } from '@openkaiden/api';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createOllama } from 'ollama-ai-provider-v2';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { PodmanAiLabExtension } from './podman-ai-lab-extension';

vi.mock(import('node:crypto'));
vi.mock(import('node:os'));
vi.mock(import('@openkaiden/api'));
vi.mock(import('ollama-ai-provider-v2'));

class TestPodmanAiLabExtension extends PodmanAiLabExtension {
  public async updateModelsAndStatus(provider: Provider): Promise<void> {
    return super.updateModelsAndStatus(provider);
  }
}

describe('PodmanAiLabExtension', () => {
  let extensionContext: ExtensionContext;
  let aiLabProvider: Provider;
  let extension: TestPodmanAiLabExtension;

  const server = setupServer();

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    server.resetHandlers();
    vi.resetAllMocks();
    aiLabProvider = {
      updateStatus: vi.fn(),
      registerInferenceProviderConnection: vi.fn(),
      dispose: vi.fn(),
    } as unknown as Provider;
    vi.mocked(randomUUID).mockReturnValue('00000000-0000-0000-0000-000000000000');
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false } as NetworkInterfaceInfo],
    });
    vi.mocked(provider.createProvider).mockReturnValue(aiLabProvider);
    vi.mocked(env).isWindows = false;
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    extension = new TestPodmanAiLabExtension(extensionContext);
  });

  afterAll(() => {
    server.close();
  });

  test('should use local IP endpoint on Windows', async () => {
    vi.mocked(env).isWindows = true;
    server.use(
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })),
    );
    await extension.activate();
    expect(vi.mocked(provider.createProvider)).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Podman AI Lab', id: 'podman-ai-lab' }),
    );
    expect(extensionContext.subscriptions).toContain(aiLabProvider);
    expect(vi.mocked(aiLabProvider.registerInferenceProviderConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://192.168.1.100:10434' }),
    );
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('started');
  });

  test('should use localhost endpoint on macOS/Linux', async () => {
    server.use(
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })),
    );
    await extension.activate();
    expect(vi.mocked(aiLabProvider.registerInferenceProviderConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:10434' }),
    );
  });

  test('should set status to stopped if fetch fails', async () => {
    server.use(
      http.get('http://localhost:10434/api/ps', () => {
        throw new Error('fail');
      }),
    );
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('stopped');
    expect(vi.mocked(aiLabProvider.registerInferenceProviderConnection)).not.toHaveBeenCalled();
  });

  test('should set status to stopped on non-ok response', async () => {
    server.use(http.get('http://localhost:10434/api/ps', () => new HttpResponse(null, { status: 503 })));
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('stopped');
  });

  test('should dispose old connection and register new one if models change', async () => {
    const firstDispose = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValue({ dispose: firstDispose });
    const models = [{ name: 'm1' }];
    server.use(
      http.get('http://localhost:10434/api/ps', () => {
        return HttpResponse.json({ models });
      }),
    );
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
    expect(firstDispose).not.toHaveBeenCalled();
    models.push({ name: 'm2' });
    await extension.updateModelsAndStatus(aiLabProvider);
    expect(firstDispose).toHaveBeenCalled();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
  });

  test('should not re-register connection if models are unchanged', async () => {
    server.use(
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })),
    );
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
    await extension.updateModelsAndStatus(aiLabProvider);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
  });

  test('should register connection with ollama SDK baseURL and llmMetadata', async () => {
    server.use(http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'granite3' }] })));
    await extension.activate();
    expect(vi.mocked(createOllama)).toHaveBeenCalledWith({ baseURL: 'http://localhost:10434/api' });
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'podman-ai-lab',
        type: 'local',
        llmMetadata: { name: 'ollama' },
        models: [{ label: 'granite3' }],
      }),
    );
  });

  test('should handle empty models array from daemon', async () => {
    server.use(http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [] })));
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('started');
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should handle malformed response gracefully', async () => {
    server.use(http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ unexpected: 'data' })));
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('started');
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should filter out model entries with non-string names', async () => {
    server.use(
      http.get('http://localhost:10434/api/ps', () =>
        HttpResponse.json({ models: [{ name: 'valid-model' }, { foo: 1 }, { name: 42 }, null] }),
      ),
    );
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [{ label: 'valid-model' }],
      }),
    );
  });

  test('should dispose connection and clear state on deactivate', async () => {
    const disposeFn = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValue({ dispose: disposeFn });
    server.use(http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }] })));
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);

    await extension.deactivate();
    expect(disposeFn).toHaveBeenCalled();
  });
});
