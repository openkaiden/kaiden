/**********************************************************************
 * Copyright (C) 2025-2026 Red Hat, Inc.
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

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import type {
  CancellationToken,
  Configuration,
  configuration as ConfigurationAPI,
  Disposable,
  Logger,
  Provider,
  provider as ProviderAPI,
  SecretStorage,
} from '@openkaiden/api';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { OpenAI, PROVIDER_ID, type StoredConnection, TOKENS_KEY } from './openAI';

vi.mock(import('node:crypto'));

vi.mock('@openkaiden/api', () => ({
  Disposable: {
    create: (func: () => void): Disposable => {
      return {
        dispose: func,
      };
    },
    from: vi.fn(),
  },
}));

vi.mock(import('@ai-sdk/openai-compatible'), () => ({
  createOpenAICompatible: vi.fn(),
}));

const OPENAI_PROVIDER_MOCK: OpenAICompatibleProvider = {} as unknown as OpenAICompatibleProvider;

const PROVIDER_API_MOCK: typeof ProviderAPI = {
  createProvider: vi.fn(),
} as unknown as typeof ProviderAPI;

const PROVIDER_MOCK: Provider = {
  id: 'openai',
  name: 'OpenAI',
  setInferenceProviderConnectionFactory: vi.fn(),
  registerInferenceProviderConnection: vi.fn(),
} as unknown as Provider;

const SECRET_STORAGE_MOCK: SecretStorage = {
  get: vi.fn(),
  store: vi.fn(),
  delete: vi.fn(),
  onDidChange: vi.fn(),
};

const CONFIG_UPDATE_MOCK = vi.fn();

const CONFIGURATION_MOCK: Configuration = {
  get: vi.fn(),
  has: vi.fn(),
  update: CONFIG_UPDATE_MOCK,
} as unknown as Configuration;

const CONFIGURATION_API_MOCK: typeof ConfigurationAPI = {
  getConfiguration: vi.fn().mockReturnValue(CONFIGURATION_MOCK),
  onDidChangeConfiguration: vi.fn(),
} as unknown as typeof ConfigurationAPI;

const fetchMock = vi.fn();

global.fetch = fetchMock;

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(randomUUID).mockReturnValue('fake-uuid-1' as ReturnType<typeof randomUUID>);
  vi.mocked(PROVIDER_API_MOCK.createProvider).mockReturnValue(PROVIDER_MOCK as Provider);
  vi.mocked(createOpenAICompatible).mockReturnValue(OPENAI_PROVIDER_MOCK);
  vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(undefined);
  vi.mocked(CONFIGURATION_API_MOCK.getConfiguration).mockReturnValue(CONFIGURATION_MOCK);

  fetchMock.mockResolvedValue({
    status: 200,
    json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }] }),
  });
});

test('constructor should not do anything', async () => {
  const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
  expect(openai).instanceof(OpenAI);

  expect(PROVIDER_API_MOCK.createProvider).not.toHaveBeenCalled();
});

describe('init', () => {
  test('should register provider', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    expect(PROVIDER_API_MOCK.createProvider).toHaveBeenCalledOnce();
    expect(PROVIDER_API_MOCK.createProvider).toHaveBeenCalledWith({
      name: 'OpenAI',
      status: 'unknown',
      id: 'openai',
    });
  });

  test('should register inference factory', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledWith({
      connectionTypes: ['cloud'],
      llmMetadata: { name: 'openai' },
      create: expect.any(Function),
    });
  });

  test('should not restore any connection if no secrets', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });
});

describe('factory', () => {
  let create: (params: { [key: string]: unknown }, logger?: Logger, token?: CancellationToken) => Promise<void>;
  beforeEach(async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    assert(mock, 'setInferenceProviderConnectionFactory must be defined');
    create = mock.mock.calls[0][0].create;
  });

  test('calling create without params should throw invalid apiKey', async () => {
    await expect(() => {
      return create({});
    }).rejects.toThrowError('invalid apiKey');
  });

  test('calling create without baseURL should throw invalid baseURL', async () => {
    await expect(() => {
      return create({ 'openai.factory.apiKey': 'dummyKey' });
    }).rejects.toThrowError('invalid baseURL');
  });

  test('calling create with proper params should save connection as JSON', async () => {
    await create({
      'openai.factory.apiKey': 'dummyKey',
      'openai.factory.baseURL': 'http://localhost:11434/v1',
    });

    const expected: StoredConnection[] = [
      { id: 'fake-uuid-1', apiKey: 'dummyKey', baseURL: 'http://localhost:11434/v1' },
    ];
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(TOKENS_KEY, JSON.stringify(expected));
  });

  test('calling create should fetch models, create SDK and register inference connection', async () => {
    await create({
      'openai.factory.apiKey': 'dummyKey',
      'openai.factory.baseURL': 'http://localhost:11434/v1',
    });

    // listModels should fetch from baseURL
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/models', {
      headers: { Authorization: 'Bearer dummyKey' },
    });

    // ensure the SDK is created with proper params
    expect(createOpenAICompatible).toHaveBeenCalledOnce();
    expect(createOpenAICompatible).toHaveBeenCalledWith({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'dummyKey',
      name: 'http://localhost:11434/v1',
    });

    // ensure the connection has been registered with models and credentials
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    const call = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mock.calls[0][0];
    expect(call.name).toBe('http://localhost:11434/v1');
    expect(call.type).toBe('cloud');
    expect(call.llmMetadata).toEqual({ name: 'openai' });
    expect(call.endpoint).toBe('http://localhost:11434/v1');
    expect(call.sdk).toBe(OPENAI_PROVIDER_MOCK);
    expect(call.status).toEqual(expect.any(Function));
    expect(call.lifecycle).toEqual({ delete: expect.any(Function) });
    expect(call.models).toEqual([{ label: 'gpt-4o' }, { label: 'gpt-4.1' }]);
    expect(call.credentials()).toEqual({ 'openai:tokens': 'dummyKey' });
  });

  test('should rollback saved config if registration fails', async () => {
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockImplementation(() => {
      throw new Error('registration boom');
    });

    await expect(
      create({
        'openai.factory.apiKey': 'dummyKey',
        'openai.factory.baseURL': 'http://localhost:11434/v1',
      }),
    ).rejects.toThrow('registration boom');

    expect(SECRET_STORAGE_MOCK.delete).toHaveBeenCalledWith('openai:fake-uuid-1:token');
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection._type', undefined);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection.OPENAI_API_KEY', undefined);
  });
});

describe('connection delete lifecycle', () => {
  let openai: OpenAI;
  let mDelete: (logger?: Logger) => Promise<void>;
  const disposeMock = vi.fn();

  beforeEach(async () => {
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockReturnValue({
      dispose: disposeMock,
    });

    openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    // Get the create factory
    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({
      'openai.factory.apiKey': 'dummyKey',
      'openai.factory.baseURL': 'http://localhost:11434/v1',
    });

    const registerMock = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection);
    const lifecycle = registerMock.mock.calls[0][0].lifecycle;
    assert(lifecycle?.delete, 'delete method of lifecycle must be defined');

    mDelete = lifecycle.delete;
  });

  test('calling delete should update secrets, clear configuration, and dispose provider inference connection', async () => {
    await mDelete();

    // per-connection secret should be deleted
    expect(SECRET_STORAGE_MOCK.delete).toHaveBeenCalledWith(`${PROVIDER_ID}:fake-uuid-1:token`);

    // configuration values should be cleared
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection._type', undefined);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection.OPENAI_API_KEY', undefined);

    // provider inference connection should be disposed
    expect(disposeMock).toHaveBeenCalledOnce();
  });
});

describe('workspace configuration', () => {
  beforeEach(async () => {
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockReturnValue({
      dispose: vi.fn(),
    });
  });

  test('should store per-connection secret and set configuration after registration', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({
      'openai.factory.apiKey': 'dummyKey',
      'openai.factory.baseURL': 'http://localhost:11434/v1',
    });

    // per-connection secret should be created
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(`${PROVIDER_ID}:fake-uuid-1:token`, 'dummyKey');

    // configuration should be scoped to the connection object
    const connection = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mock.calls[0][0];
    expect(CONFIGURATION_API_MOCK.getConfiguration).toHaveBeenCalledWith(undefined, connection);

    // _type and token should be set
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection._type', PROVIDER_ID);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith(
      'openai.connection.OPENAI_API_KEY',
      `${PROVIDER_ID}:fake-uuid-1:token`,
    );
  });

  test('should set workspace configuration for each restored connection', async () => {
    const stored: StoredConnection[] = [
      { id: 'id-1', apiKey: 'key1', baseURL: 'http://a/v1' },
      { id: 'id-2', apiKey: 'key2', baseURL: 'http://b/v1' },
    ];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));

    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    // per-connection secrets should be created for each connection
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(`${PROVIDER_ID}:id-1:token`, 'key1');
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(`${PROVIDER_ID}:id-2:token`, 'key2');

    // configuration should be set for each connection
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection._type', PROVIDER_ID);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection.OPENAI_API_KEY', `${PROVIDER_ID}:id-1:token`);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('openai.connection.OPENAI_API_KEY', `${PROVIDER_ID}:id-2:token`);
  });
});

describe('restoreConnections', () => {
  test('should restore multiple connections from JSON storage on init', async () => {
    const stored: StoredConnection[] = [
      { id: 'id-1', apiKey: 'key1', baseURL: 'http://a/v1' },
      { id: 'id-2', apiKey: 'key2', baseURL: 'http://b/v1' },
    ];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));

    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-1' }),
    );
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-2' }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://a/v1/models', {
      headers: { Authorization: 'Bearer key1' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://b/v1/models', {
      headers: { Authorization: 'Bearer key2' },
    });
  });

  test('should restore connections even when one fails model listing', async () => {
    const stored: StoredConnection[] = [
      { id: 'id-1', apiKey: 'key1', baseURL: 'http://a/v1' },
      { id: 'id-2', apiKey: 'key2', baseURL: 'http://b/v1' },
    ];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));
    fetchMock.mockResolvedValueOnce({ status: 500, json: async () => ({}) });

    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://a/v1/models', {
      headers: { Authorization: 'Bearer key1' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://b/v1/models', {
      headers: { Authorization: 'Bearer key2' },
    });
  });

  test('should log a warning when listModels fails during restore', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored: StoredConnection[] = [{ id: 'id-1', apiKey: 'key1', baseURL: 'http://a/v1' }];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));
    fetchMock.mockResolvedValueOnce({ status: 403, json: async () => ({}) });

    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('openai: failed to list models for http://a/v1'),
      expect.any(Error),
    );

    // Connection should still be registered with stopped status and empty models
    const call = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mock.calls[0][0];
    expect(call.models).toEqual([]);
    expect(call.status()).toBe('stopped');

    warnSpy.mockRestore();
  });

  test('should migrate legacy pipe+comma-separated format to JSON', async () => {
    vi.mocked(randomUUID)
      .mockReturnValueOnce('migrated-id-1' as ReturnType<typeof randomUUID>)
      .mockReturnValueOnce('migrated-id-2' as ReturnType<typeof randomUUID>);
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue('key1|http://a/v1,key2|http://b/v1');

    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const expected: StoredConnection[] = [
      { id: 'migrated-id-1', apiKey: 'key1', baseURL: 'http://a/v1' },
      { id: 'migrated-id-2', apiKey: 'key2', baseURL: 'http://b/v1' },
    ];
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(TOKENS_KEY, JSON.stringify(expected));
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'migrated-id-1' }),
    );
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'migrated-id-2' }),
    );
  });
});

describe('listModels error handling (through factory)', () => {
  test('non-200 response should return undefined', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    fetchMock.mockResolvedValueOnce({ status: 500, json: async () => ({}) });

    await expect(create({ 'openai.factory.apiKey': 'k', 'openai.factory.baseURL': 'http://x/v1' })).resolves.toBe(
      undefined,
    );
  });

  test('missing data field should return undefined', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({}) });

    await expect(create({ 'openai.factory.apiKey': 'k', 'openai.factory.baseURL': 'http://x/v1' })).resolves.toBe(
      undefined,
    );
  });

  test('data not array should return undefined', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ data: {} }) });

    await expect(create({ 'openai.factory.apiKey': 'k', 'openai.factory.baseURL': 'http://x/v1' })).resolves.toBe(
      undefined,
    );
  });
});

describe('duplicate connection prevention', () => {
  test('creating the same connection twice should throw', async () => {
    const openai = new OpenAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
    await openai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({ 'openai.factory.apiKey': 'dup', 'openai.factory.baseURL': 'http://dup/v1' });

    const stored: StoredConnection[] = [{ id: 'fake-uuid-1', apiKey: 'dup', baseURL: 'http://dup/v1' }];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));

    await expect(
      create({ 'openai.factory.apiKey': 'dup', 'openai.factory.baseURL': 'http://dup/v1' }),
    ).rejects.toThrowError('connection already exists for baseURL http://dup/v1');
  });
});
