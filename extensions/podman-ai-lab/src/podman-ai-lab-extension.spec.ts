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

import type { NetworkInterfaceInfo } from 'node:os';
import { networkInterfaces } from 'node:os';

import type { ExtensionContext, Provider } from '@openkaiden/api';
import { env, provider } from '@openkaiden/api';
import { http, HttpResponse } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { PodmanAiLabExtension } from './podman-ai-lab-extension';

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
  let server: SetupServerApi | undefined = undefined;

  beforeEach(() => {
    aiLabProvider = {
      updateStatus: vi.fn(),
      registerInferenceProviderConnection: vi.fn(),
      dispose: vi.fn(),
    } as unknown as Provider;
    vi.resetAllMocks();
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [{ address: '192.168.1.100', family: 'IPv4', internal: false } as NetworkInterfaceInfo],
    });
    vi.mocked(provider.createProvider).mockReturnValue(aiLabProvider);
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    extension = new TestPodmanAiLabExtension(extensionContext);
  });

  afterEach(() => {
    server?.close();
  });

  test('should use local IP endpoint on Windows', async () => {
    vi.mocked(env).isWindows = true;
    const handlers = [
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })),
    ];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
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
    vi.mocked(env).isWindows = false;
    const handlers = [
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })),
    ];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
    await extension.activate();
    expect(vi.mocked(aiLabProvider.registerInferenceProviderConnection)).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://localhost:10434' }),
    );
  });

  test('should set status to stopped if fetch fails', async () => {
    const handlers = [
      http.get('http://localhost:10434/api/ps', () => {
        throw new Error('fail');
      }),
    ];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('stopped');
    expect(vi.mocked(aiLabProvider.registerInferenceProviderConnection)).not.toHaveBeenCalled();
  });

  test('should set status to stopped on non-ok response', async () => {
    const handlers = [http.get('http://localhost:10434/api/ps', () => new HttpResponse(null, { status: 503 }))];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('stopped');
  });

  test('should unregister and register new connection if models change', async () => {
    const models = [{ name: 'm1' }];
    const handlers = [
      http.get('http://localhost:10434/api/ps', () => {
        return HttpResponse.json({ models });
      }),
    ];
    server = setupServer(...handlers);
    server.listen();
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
    models.push({ name: 'm2' });
    await extension.updateModelsAndStatus(aiLabProvider);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
  });

  test('should not re-register connection if models are unchanged', async () => {
    const handlers = [
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })),
    ];
    server = setupServer(...handlers);
    server.listen();
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
    await extension.updateModelsAndStatus(aiLabProvider);
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);
  });

  test('should register connection with ollama llmMetadata and local type', async () => {
    vi.mocked(env).isWindows = false;
    const handlers = [
      http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'granite3' }] })),
    ];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
    await extension.activate();
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
    const handlers = [http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [] }))];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('started');
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should handle malformed response gracefully', async () => {
    const handlers = [http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ unexpected: 'data' }))];
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
    await extension.activate();
    expect(vi.mocked(aiLabProvider.updateStatus)).toHaveBeenCalledWith('started');
    expect(aiLabProvider.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should dispose connection and clear state on deactivate', async () => {
    const disposeFn = vi.fn();
    vi.mocked(aiLabProvider.registerInferenceProviderConnection).mockReturnValue({ dispose: disposeFn });
    const handlers = [http.get('http://localhost:10434/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }] }))];
    server = setupServer(...handlers);
    server.listen();
    await extension.activate();
    expect(aiLabProvider.registerInferenceProviderConnection).toHaveBeenCalledTimes(1);

    await extension.deactivate();
    expect(disposeFn).toHaveBeenCalled();
  });
});
