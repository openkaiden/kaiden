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

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Configuration, ConfigurationChangeEvent, ExtensionContext, Provider } from '@openkaiden/api';
import { configuration, provider } from '@openkaiden/api';
import { delay, http, type HttpHandler, HttpResponse } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { LLMMAN_DEFAULT_ENDPOINT, LLMMAN_ENDPOINT_SETTING, LlmmanExtension } from './llmman-extension';

vi.mock(import('@openkaiden/api'));
vi.mock(import('@ai-sdk/openai-compatible'));

const OTHER_ENDPOINT = 'http://127.0.0.1:18000';

class TestLlmmanExtension extends LlmmanExtension {
  requestTimeoutMs = 10_000;

  public async updateModelsAndStatus(provider: Provider): Promise<void> {
    return super.updateModelsAndStatus(provider);
  }

  public getEndpoint(): string {
    return super.getEndpoint();
  }

  protected getRequestTimeoutMs(): number {
    return this.requestTimeoutMs;
  }
}

function modelsResponse(ids: unknown[]): Response {
  return HttpResponse.json({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) });
}

describe('LlmmanExtension', () => {
  let extensionContext: ExtensionContext;
  let llmmanProvider: Provider;
  let extension: TestLlmmanExtension;
  let connectionDisposable: { dispose: ReturnType<typeof vi.fn> };
  let configurationListener: ((event: ConfigurationChangeEvent) => void) | undefined;
  let configuredEndpoint: string | undefined;
  let server: SetupServerApi | undefined;

  const registerConnection = (): ReturnType<typeof vi.mocked<Provider['registerInferenceProviderConnection']>> =>
    vi.mocked(llmmanProvider.registerInferenceProviderConnection);

  function serve(...handlers: HttpHandler[]): void {
    server = setupServer(...handlers);
    server.listen({ onUnhandledRequest: 'error' });
  }

  function serveModels(ids: unknown[], endpoint = LLMMAN_DEFAULT_ENDPOINT): void {
    serve(http.get(`${endpoint}/v1/models`, () => modelsResponse(ids)));
  }

  function changeEndpointSetting(endpoint: string): void {
    configuredEndpoint = endpoint;
    configurationListener?.({
      affectsConfiguration: (section: string) => section === LLMMAN_ENDPOINT_SETTING,
    } as ConfigurationChangeEvent);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    configuredEndpoint = undefined;
    configurationListener = undefined;

    connectionDisposable = { dispose: vi.fn() };
    llmmanProvider = {
      updateStatus: vi.fn(),
      registerInferenceProviderConnection: vi.fn().mockReturnValue(connectionDisposable),
      dispose: vi.fn(),
    } as unknown as Provider;
    vi.mocked(provider.createProvider).mockReturnValue(llmmanProvider);
    vi.mocked(configuration.getConfiguration).mockReturnValue({
      get: vi.fn().mockImplementation(() => configuredEndpoint),
    } as unknown as Configuration);
    vi.mocked(configuration.onDidChangeConfiguration).mockImplementation(listener => {
      configurationListener = listener;
      return { dispose: vi.fn() };
    });

    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    extension = new TestLlmmanExtension(extensionContext);
  });

  afterEach(async () => {
    await extension.deactivate();
    server?.close();
    server = undefined;
  });

  test('creates the provider and registers models from /v1/models', async () => {
    serveModels(['hf.co/unsloth/Qwen3.5-0.8B-GGUF:latest', 'docker.io/ai/gemma4:latest']);

    await extension.activate();

    expect(vi.mocked(provider.createProvider)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'llmman', name: 'llmman', status: 'unknown' }),
    );
    expect(extensionContext.subscriptions).toContain(llmmanProvider);
    expect(vi.mocked(llmmanProvider.updateStatus)).toHaveBeenCalledWith('started');
    expect(vi.mocked(createOpenAICompatible)).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: `${LLMMAN_DEFAULT_ENDPOINT}/v1`, name: 'llmman' }),
    );
    expect(registerConnection()).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'llmman',
        type: 'local',
        llmMetadata: { name: 'openai' },
        endpoint: `${LLMMAN_DEFAULT_ENDPOINT}/v1`,
        models: [{ label: 'docker.io/ai/gemma4:latest' }, { label: 'hf.co/unsloth/Qwen3.5-0.8B-GGUF:latest' }],
      }),
    );
    const connection = registerConnection().mock.calls[0]?.[0];
    expect(connection?.status()).toBe('started');
    expect(connection?.credentials()).toEqual({});
  });

  test.each([
    [
      'unreachable daemon',
      (): Response => {
        throw new Error('connection refused');
      },
    ],
    ['HTTP error', (): Response => new HttpResponse(undefined, { status: 500 })],
  ])('reports stopped and registers nothing on %s', async (_, handler) => {
    serve(http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, handler));

    await extension.activate();

    expect(vi.mocked(llmmanProvider.updateStatus)).toHaveBeenCalledWith('stopped');
    expect(registerConnection()).not.toHaveBeenCalled();
  });

  test('reports stopped when the daemon does not answer within the timeout', async () => {
    extension.requestTimeoutMs = 50;
    serve(http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, async () => delay('infinite')));

    await extension.activate();

    expect(vi.mocked(llmmanProvider.updateStatus)).toHaveBeenCalledWith('stopped');
    expect(registerConnection()).not.toHaveBeenCalled();
  });

  test('reports started but registers nothing when the store is empty', async () => {
    serveModels([]);

    await extension.activate();

    expect(vi.mocked(llmmanProvider.updateStatus)).toHaveBeenCalledWith('started');
    expect(registerConnection()).not.toHaveBeenCalled();
  });

  test('ignores entries without a string id', async () => {
    serveModels(['docker.io/ai/gemma4:latest', 42, undefined]);

    await extension.activate();

    expect(registerConnection()).toHaveBeenCalledWith(
      expect.objectContaining({ models: [{ label: 'docker.io/ai/gemma4:latest' }] }),
    );
  });

  test('does not re-register when the model list is unchanged', async () => {
    serveModels(['m1', 'm2']);

    await extension.activate();
    await extension.updateModelsAndStatus(llmmanProvider);

    expect(registerConnection()).toHaveBeenCalledTimes(1);
    expect(connectionDisposable.dispose).not.toHaveBeenCalled();
  });

  test('replaces the connection when models change', async () => {
    const ids = ['m1'];
    serveModels(ids);

    await extension.activate();
    ids.push('m2');
    await extension.updateModelsAndStatus(llmmanProvider);

    expect(connectionDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(registerConnection()).toHaveBeenCalledTimes(2);
    expect(registerConnection()).toHaveBeenLastCalledWith(
      expect.objectContaining({ models: [{ label: 'm1' }, { label: 'm2' }] }),
    );
  });

  test('keeps polling and retries registration after a failure', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    serveModels(['m1']);
    registerConnection().mockImplementationOnce(() => {
      throw new Error('registration failed');
    });

    await extension.activate();
    expect(console.error).toHaveBeenCalledWith('Error updating llmman models and status:', expect.any(Error));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(registerConnection()).toHaveBeenCalledTimes(2);
  });

  test('disposes the connection when the daemon goes away', async () => {
    let up = true;
    serve(
      http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, () => {
        if (!up) throw new Error('connection refused');
        return modelsResponse(['m1']);
      }),
    );

    await extension.activate();
    up = false;
    await extension.updateModelsAndStatus(llmmanProvider);

    expect(connectionDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(vi.mocked(llmmanProvider.updateStatus)).toHaveBeenLastCalledWith('stopped');
  });

  test('uses the configured endpoint, stripping trailing slashes', async () => {
    configuredEndpoint = `${OTHER_ENDPOINT}/`;
    serveModels(['m1'], OTHER_ENDPOINT);

    await extension.activate();

    expect(extension.getEndpoint()).toBe(OTHER_ENDPOINT);
    expect(vi.mocked(configuration.getConfiguration)).toHaveBeenCalledWith('llmman');
    expect(registerConnection()).toHaveBeenCalledWith(expect.objectContaining({ endpoint: `${OTHER_ENDPOINT}/v1` }));
  });

  test('falls back to the default endpoint when the setting is blank', () => {
    configuredEndpoint = '   ';

    expect(extension.getEndpoint()).toBe(LLMMAN_DEFAULT_ENDPOINT);
  });

  test('re-registers when the endpoint setting changes', async () => {
    serve(
      http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, () => modelsResponse(['m1'])),
      http.get(`${OTHER_ENDPOINT}/v1/models`, () => modelsResponse(['m1'])),
    );

    await extension.activate();
    expect(configurationListener).toBeDefined();

    configurationListener?.({ affectsConfiguration: () => false } as ConfigurationChangeEvent);
    await vi.waitFor(() => expect(vi.mocked(llmmanProvider.updateStatus)).toHaveBeenCalledTimes(1));

    changeEndpointSetting(OTHER_ENDPOINT);
    await vi.waitFor(() => expect(registerConnection()).toHaveBeenCalledTimes(2));

    expect(connectionDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(registerConnection()).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: `${OTHER_ENDPOINT}/v1` }),
    );
  });

  test('ignores a stale refresh that completes after a newer one', async () => {
    let releaseOld: (() => void) | undefined;
    let holdOld = false;
    serve(
      http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, async () => {
        if (holdOld) await new Promise<void>(resolve => (releaseOld = resolve));
        return modelsResponse(['old']);
      }),
      http.get(`${OTHER_ENDPOINT}/v1/models`, () => modelsResponse(['new'])),
    );

    await extension.activate();
    holdOld = true;
    const stale = extension.updateModelsAndStatus(llmmanProvider);
    await vi.waitFor(() => expect(releaseOld).toBeDefined());

    configuredEndpoint = OTHER_ENDPOINT;
    await extension.updateModelsAndStatus(llmmanProvider);
    releaseOld?.();
    await stale;

    expect(registerConnection()).toHaveBeenCalledTimes(2);
    expect(registerConnection()).toHaveBeenLastCalledWith(
      expect.objectContaining({ endpoint: `${OTHER_ENDPOINT}/v1`, models: [{ label: 'new' }] }),
    );
    expect(connectionDisposable.dispose).toHaveBeenCalledTimes(1);
  });

  test('polls periodically', async () => {
    vi.useFakeTimers();
    const handler = vi.fn(() => modelsResponse(['m1']));
    serve(http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, handler));

    await extension.activate();
    expect(handler).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('deactivate during the initial request registers nothing and does not start polling', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const handler = vi.fn(async () => {
      await new Promise<void>(resolve => (release = resolve));
      return modelsResponse(['m1']);
    });
    serve(http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, handler));

    const activating = extension.activate();
    await vi.waitFor(() => expect(release).toBeDefined());
    await extension.deactivate();
    release?.();
    await activating;

    expect(registerConnection()).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('ignores configuration changes after deactivate', async () => {
    const handler = vi.fn(() => modelsResponse(['m1']));
    serve(http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, handler));

    await extension.activate();
    await extension.deactivate();
    changeEndpointSetting(LLMMAN_DEFAULT_ENDPOINT);
    await new Promise(resolve => setImmediate(resolve));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(registerConnection()).toHaveBeenCalledTimes(1);
  });

  test('deactivate stops polling and disposes the connection', async () => {
    vi.useFakeTimers();
    const handler = vi.fn(() => modelsResponse(['m1']));
    serve(http.get(`${LLMMAN_DEFAULT_ENDPOINT}/v1/models`, handler));

    await extension.activate();
    await extension.deactivate();

    expect(connectionDisposable.dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
