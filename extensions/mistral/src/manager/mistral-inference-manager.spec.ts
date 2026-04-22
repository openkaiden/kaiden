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

import { createMistral, type MistralProvider } from '@ai-sdk/mistral';
import { Mistral } from '@mistralai/mistralai';
import type { CancellationToken, Disposable, Logger, Provider, SecretStorage } from '@openkaiden/api';
import { Container } from 'inversify';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { MistralProviderSymbol, SecretStorageSymbol } from '/@/inject/symbol';

import { MistralInferenceManager, TOKENS_KEY } from './mistral-inference-manager';

vi.mock(import('@ai-sdk/mistral'));

const mockList = vi.fn();

vi.mock(import('@mistralai/mistralai'), async () => {
  return {
    Mistral: vi.fn().mockImplementation(function () {
      return {
        models: {
          list: mockList,
        },
      };
    }),
  };
});

const MISTRAL_PROVIDER_MOCK: MistralProvider = {} as unknown as MistralProvider;

const PROVIDER_MOCK: Provider = {
  setInferenceProviderConnectionFactory: vi.fn(),
  registerInferenceProviderConnection: vi.fn(),
} as unknown as Provider;

const SECRET_STORAGE_MOCK: SecretStorage = {
  get: vi.fn(),
  store: vi.fn(),
  delete: vi.fn(),
  onDidChange: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(createMistral).mockReturnValue(MISTRAL_PROVIDER_MOCK);

  vi.mocked(Mistral).mockImplementation(function () {
    return {
      models: {
        list: mockList,
      },
    };
  } as unknown as (...args: unknown[]) => Mistral);

  mockList.mockResolvedValue({
    data: [
      { id: 'mistral-large-latest', capabilities: { completionChat: true } },
      { id: 'mistral-small-latest', capabilities: { completionChat: true } },
    ],
  });
});

async function createManager(): Promise<MistralInferenceManager> {
  const container = new Container();
  container.bind(MistralInferenceManager).toSelf();
  container.bind(MistralProviderSymbol).toConstantValue(PROVIDER_MOCK);
  container.bind(SecretStorageSymbol).toConstantValue(SECRET_STORAGE_MOCK);
  return container.getAsync<MistralInferenceManager>(MistralInferenceManager);
}

describe('init', () => {
  test('should register inference factory', async () => {
    const manager = await createManager();
    await manager.init();

    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledWith({
      create: expect.any(Function),
    });
  });

  test('should restore connections from secret storage', async () => {
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue('existingKey');

    const manager = await createManager();
    await manager.init();

    expect(SECRET_STORAGE_MOCK.get).toHaveBeenCalledWith(TOKENS_KEY);
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
  });

  test('should handle empty secret storage', async () => {
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(undefined);

    const manager = await createManager();
    await manager.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });
});

describe('factory', () => {
  let create: (params: { [key: string]: unknown }, logger?: Logger, token?: CancellationToken) => Promise<void>;

  beforeEach(async () => {
    const manager = await createManager();
    await manager.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    assert(mock, 'setInferenceProviderConnectionFactory must be defined');
    create = mock.mock.calls[0][0].create;
  });

  test('calling create without params should throw', async () => {
    await expect(() => {
      return create({});
    }).rejects.toThrowError('invalid apiKey');
  });

  test('calling create with proper params should save token', async () => {
    await create({
      'mistral.factory.apiKey': 'dummyKey',
    });

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledOnce();
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(TOKENS_KEY, 'dummyKey');
  });

  test('calling create with proper params should register inference connection', async () => {
    await create({
      'mistral.factory.apiKey': 'dummyKey',
    });

    expect(createMistral).toHaveBeenCalledOnce();
    expect(createMistral).toHaveBeenCalledWith({
      apiKey: 'dummyKey',
    });

    expect(Mistral).toHaveBeenCalledWith({
      apiKey: 'dummyKey',
    });

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith({
      name: 'dum*****',
      type: 'cloud',
      providerName: 'mistral',
      status: expect.any(Function),
      lifecycle: {
        delete: expect.any(Function),
      },
      sdk: MISTRAL_PROVIDER_MOCK,
      models: [{ label: 'mistral-large-latest' }, { label: 'mistral-small-latest' }],
      credentials: expect.any(Function),
    });
  });
});

describe('connection delete lifecycle', () => {
  let manager: MistralInferenceManager;
  let mDelete: (logger?: Logger) => Promise<void>;
  const disposeMock = vi.fn();

  beforeEach(async () => {
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockReturnValue({
      dispose: disposeMock,
    } as unknown as Disposable);

    manager = await createManager();
    await manager.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({
      'mistral.factory.apiKey': 'dummyKey',
    });

    const registerMock = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection);
    const lifecycle = registerMock.mock.calls[0][0].lifecycle;
    assert(lifecycle?.delete, 'delete method of lifecycle must be defined');

    mDelete = lifecycle.delete;
  });

  test('calling delete should delete the token', async () => {
    await mDelete();

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledTimes(2);

    // first time when registering the connection
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenNthCalledWith(1, TOKENS_KEY, 'dummyKey');

    // second time when unregistering the connection
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenNthCalledWith(2, TOKENS_KEY, '');
  });

  test('calling delete should dispose provider inference connection', async () => {
    await mDelete();

    expect(disposeMock).toHaveBeenCalledOnce();
  });
});

describe('dispose', () => {
  test('should dispose all connections', async () => {
    const disposeMock = vi.fn();
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockReturnValue({
      dispose: disposeMock,
    } as unknown as Disposable);

    const manager = await createManager();
    await manager.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({
      'mistral.factory.apiKey': 'dummyKey',
    });

    manager.dispose();

    expect(disposeMock).toHaveBeenCalledOnce();
  });
});
