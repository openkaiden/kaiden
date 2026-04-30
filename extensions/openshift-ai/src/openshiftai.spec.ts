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

import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { KubeConfig } from '@kubernetes/client-node';
import type {
  CancellationToken,
  Disposable,
  Logger,
  Provider,
  provider as ProviderAPI,
  SecretStorage,
} from '@openkaiden/api';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { OpenShiftAI, TOKENS_KEY } from './openshiftai';

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

const listClusterCustomObjectMock = vi.fn();
const listNamespacedCustomObjectMock = vi.fn();
const listNamespacedSecretMock = vi.fn();

vi.mock(import('@kubernetes/client-node'));

const OPENAI_PROVIDER_MOCK: OpenAICompatibleProvider = {} as unknown as OpenAICompatibleProvider;

const PROVIDER_API_MOCK: typeof ProviderAPI = {
  createProvider: vi.fn(),
} as unknown as typeof ProviderAPI;

const PROVIDER_MOCK: Provider = {
  id: 'openshiftai',
  name: 'OpenShift AI',
  setInferenceProviderConnectionFactory: vi.fn(),
  registerInferenceProviderConnection: vi.fn(),
} as unknown as Provider;

const SECRET_STORAGE_MOCK: SecretStorage = {
  get: vi.fn(),
  store: vi.fn(),
  delete: vi.fn(),
  onDidChange: vi.fn(),
};

const fetchMock = vi.fn();

global.fetch = fetchMock;

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(PROVIDER_API_MOCK.createProvider).mockReturnValue(PROVIDER_MOCK as Provider);
  vi.mocked(createOpenAICompatible).mockReturnValue(OPENAI_PROVIDER_MOCK);
  vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(undefined);
});

test('constructor should not do anything', async () => {
  const openshiftai = new OpenShiftAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK);
  expect(openshiftai).instanceof(OpenShiftAI);

  expect(PROVIDER_API_MOCK.createProvider).not.toHaveBeenCalled();
});

describe('init', () => {
  test('should register provider', async () => {
    const openshiftai = new OpenShiftAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK);
    await openshiftai.init();

    expect(PROVIDER_API_MOCK.createProvider).toHaveBeenCalledOnce();
    expect(PROVIDER_API_MOCK.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'OpenShift AI',
        status: 'unknown',
        id: 'openshiftai',
      }),
    );
  });

  test('should register inference factory', async () => {
    const openshiftai = new OpenShiftAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK);
    await openshiftai.init();

    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledWith({
      create: expect.any(Function),
    });
  });

  test('should not restore any connection if no secrets', async () => {
    const openshiftai = new OpenShiftAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK);
    await openshiftai.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });
});

describe('factory', () => {
  let create: (params: { [key: string]: unknown }, logger?: Logger, token?: CancellationToken) => Promise<void>;
  beforeEach(async () => {
    const openshiftai = new OpenShiftAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK);
    await openshiftai.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    assert(mock, 'setInferenceProviderConnectionFactory must be defined');
    create = mock.mock.calls[0][0].create;
  });

  test('calling create without params should throw invalid OpenShift AI URL', async () => {
    await expect(() => {
      return create({});
    }).rejects.toThrowError('invalid OpenShift AI URL');
  });

  test('calling create without token should throw invalid token', async () => {
    await expect(() => {
      return create({ 'openshiftai.factory.url': 'https://api.cluster.example.com:6443' });
    }).rejects.toThrowError('invalid token');
  });

  test('calling create with no inference services found should throw', async () => {
    listClusterCustomObjectMock.mockResolvedValue({
      items: [{ metadata: { name: 'test-project' } }],
    });
    listNamespacedCustomObjectMock.mockResolvedValue({
      items: [],
    });

    await expect(() => {
      return create({
        'openshiftai.factory.url': 'https://api.cluster.example.com:6443',
        'openshiftai.factory.token': 'dummyToken',
      });
    }).rejects.toThrowError('no inference services found on the cluster');
  });

  test('calling create with no projects should throw no inference services', async () => {
    listClusterCustomObjectMock.mockResolvedValue({
      items: [],
    });

    await expect(() => {
      return create({
        'openshiftai.factory.url': 'https://api.cluster.example.com:6443',
        'openshiftai.factory.token': 'dummyToken',
      });
    }).rejects.toThrowError('no inference services found on the cluster');
  });

  test('calling create with valid inference services should register connection', async () => {
    listClusterCustomObjectMock.mockResolvedValue({
      items: [{ metadata: { name: 'test-project' } }],
    });
    listNamespacedCustomObjectMock.mockResolvedValue({
      items: [
        {
          metadata: { name: 'my-model' },
          spec: { predictor: { model: { runtime: 'vllm' } } },
          status: { url: 'https://my-model.example.com' },
        },
      ],
    });
    listNamespacedSecretMock.mockResolvedValue({
      items: [
        {
          metadata: { annotations: { 'kubernetes.io/service-account.name': 'vllm-sa' } },
          data: { token: Buffer.from('serviceToken').toString('base64') },
        },
      ],
    });
    const coreAPI = {
      listClusterCustomObject: listClusterCustomObjectMock,
      listNamespacedSecret: listNamespacedSecretMock,
    };
    vi.mocked(KubeConfig.prototype.makeApiClient).mockReturnValueOnce(coreAPI);
    const genericAPI = {
      listNamespacedCustomObject: listNamespacedCustomObjectMock,
      listClusterCustomObject: listClusterCustomObjectMock,
    };
    vi.mocked(KubeConfig.prototype.makeApiClient).mockReturnValueOnce(genericAPI);

    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ data: [{ id: 'llama-3' }] }),
    });

    await create({
      'openshiftai.factory.url': 'https://api.cluster.example.com:6443',
      'openshiftai.factory.token': 'dummyToken',
    });

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    const call = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mock.calls[0][0];
    expect(call.name).toBe('https://api.cluster.example.com:6443');
    expect(call.type).toBe('self-hosted');
    expect(call.endpoint).toBe('https://my-model.example.com/v1');
    expect(call.sdk).toBe(OPENAI_PROVIDER_MOCK);
    expect(call.models).toEqual([{ label: 'llama-3' }]);

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledOnce();
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(
      TOKENS_KEY,
      'dummyToken|https://api.cluster.example.com:6443',
    );
  });
});

describe('restoreConnections', () => {
  test('should not crash if restore fails due to no inference services', async () => {
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue('savedToken|https://api.cluster.example.com:6443');

    listClusterCustomObjectMock.mockResolvedValue({ items: [] });

    const openshiftai = new OpenShiftAI(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK);
    await openshiftai.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });
});
