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
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type {
  Configuration,
  configuration as ConfigurationAPI,
  Disposable,
  Logger,
  Provider,
  provider as ProviderAPI,
  SecretStorage,
} from '@openkaiden/api';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  CONNECTIONS_KEY,
  FALLBACK_MODELS,
  OPENSHELL_PROVIDER_ID,
  PROVIDER_ID,
  type StoredConnection,
  VertexAi,
  type VertexAiConnectionConfig,
} from './vertex-ai';

vi.mock(import('node:crypto'));

vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));
vi.mock(import('@ai-sdk/google-vertex/anthropic'));

const VERTEX_ANTHROPIC_MOCK = {} as ReturnType<typeof createVertexAnthropic>;

const PROVIDER_MOCK: Provider = {
  setInferenceProviderConnectionFactory: vi.fn(),
  registerInferenceProviderConnection: vi.fn(),
  dispose: vi.fn(),
} as unknown as Provider;

const PROVIDER_API_MOCK = {
  createProvider: vi.fn(),
} as unknown as typeof ProviderAPI;

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

const VALID_CREDENTIALS = JSON.stringify({
  client_id: 'test-client-id.apps.googleusercontent.com',
  client_secret: 'test-client-secret',
  refresh_token: 'test-refresh-token',
  type: 'authorized_user',
});

const VALID_CONFIG: VertexAiConnectionConfig = {
  projectId: 'my-gcp-project',
  region: 'us-east5',
  credentialsFile: '/home/user/.config/gcloud/application_default_credentials.json',
};

function mockFetchResponses(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(
        JSON.stringify({ access_token: 'mock-access-token', token_type: 'Bearer', expires_in: 3600 }),
        { status: 200 },
      );
    }

    if (url.includes('aiplatform.googleapis.com/v1beta1/publishers/anthropic/models')) {
      return new Response(
        JSON.stringify({
          publisherModels: [
            { name: 'publishers/anthropic/models/claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
            { name: 'publishers/anthropic/models/claude-haiku-3.5-20241022', displayName: 'Claude 3.5 Haiku' },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response('Not found', { status: 404 });
  });
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(randomUUID).mockReturnValue('fake-uuid-1' as ReturnType<typeof randomUUID>);
  vi.mocked(PROVIDER_API_MOCK.createProvider).mockReturnValue(PROVIDER_MOCK);
  vi.mocked(createVertexAnthropic).mockReturnValue(VERTEX_ANTHROPIC_MOCK);
  vi.mocked(homedir).mockReturnValue('/home/testuser');
  vi.mocked(readFile).mockResolvedValue(VALID_CREDENTIALS);
  vi.mocked(access).mockResolvedValue(undefined);
  vi.mocked(CONFIGURATION_API_MOCK.getConfiguration).mockReturnValue(CONFIGURATION_MOCK);

  mockFetchResponses();
});

function createVertexAi(): VertexAi {
  return new VertexAi(PROVIDER_API_MOCK, SECRET_STORAGE_MOCK, CONFIGURATION_API_MOCK);
}

describe('init', () => {
  test('should create provider and register factory', async () => {
    const vertexAi = createVertexAi();
    await vertexAi.init();

    expect(PROVIDER_API_MOCK.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Vertex AI',
        id: 'vertex-ai',
      }),
    );
    expect(PROVIDER_MOCK.setInferenceProviderConnectionFactory).toHaveBeenCalledWith({
      connectionTypes: ['cloud'],
      llmMetadata: { name: 'vertexai' },
      create: expect.any(Function),
    });
  });

  test('should restore connections from secret storage with persisted IDs', async () => {
    const stored: StoredConnection[] = [{ id: 'persisted-id', ...VALID_CONFIG }];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));

    const vertexAi = createVertexAi();
    await vertexAi.init();

    expect(SECRET_STORAGE_MOCK.get).toHaveBeenCalledWith(CONNECTIONS_KEY);
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'persisted-id' }),
    );
  });

  test('should handle empty secret storage', async () => {
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(undefined);

    const vertexAi = createVertexAi();
    await vertexAi.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should restore connections with fallback models when fetch fails', async () => {
    const stored: StoredConnection[] = [{ id: 'persisted-id', ...VALID_CONFIG }];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    const vertexAi = createVertexAi();
    await vertexAi.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        models: FALLBACK_MODELS,
      }),
    );
  });

  test('should handle corrupted secret storage', async () => {
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue('not valid json');

    const vertexAi = createVertexAi();
    await vertexAi.init();

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).not.toHaveBeenCalled();
  });

  test('should migrate legacy JSON without id field', async () => {
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify([VALID_CONFIG]));

    const vertexAi = createVertexAi();
    await vertexAi.init();

    const expected: StoredConnection[] = [{ ...VALID_CONFIG, id: 'fake-uuid-1' }];
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(CONNECTIONS_KEY, JSON.stringify(expected));
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fake-uuid-1' }),
    );
  });
});

describe('readCredentials', () => {
  test('should read ADC from specified file', async () => {
    const vertexAi = createVertexAi();
    const creds = await vertexAi.readCredentials('/home/user/.config/gcloud/application_default_credentials.json');

    expect(readFile).toHaveBeenCalledWith('/home/user/.config/gcloud/application_default_credentials.json', 'utf-8');
    expect(creds.client_id).toBe('test-client-id.apps.googleusercontent.com');
  });

  test('should expand tilde in credentials path', async () => {
    const vertexAi = createVertexAi();
    await vertexAi.readCredentials('~/.config/gcloud/application_default_credentials.json');

    expect(readFile).toHaveBeenCalledWith(
      join('/home/testuser', '.config/gcloud/application_default_credentials.json'),
      'utf-8',
    );
  });

  test('should reject service-account credentials with clear error', async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ type: 'service_account', project_id: 'my-project', private_key: 'key' }),
    );

    const vertexAi = createVertexAi();
    await expect(vertexAi.readCredentials('/some/dir')).rejects.toThrow('Unsupported ADC type "service_account"');
  });

  test('should throw on missing required fields', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ type: 'authorized_user' }));

    const vertexAi = createVertexAi();
    await expect(vertexAi.readCredentials('/some/dir')).rejects.toThrow('missing required fields');
  });
});

describe('exchangeToken', () => {
  test('should exchange refresh token for access token', async () => {
    const vertexAi = createVertexAi();
    const creds = JSON.parse(VALID_CREDENTIALS);
    const token = await vertexAi.exchangeToken(creds);

    expect(token).toBe('mock-access-token');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
  });

  test('should throw on failed token exchange', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const vertexAi = createVertexAi();
    const creds = JSON.parse(VALID_CREDENTIALS);
    await expect(vertexAi.exchangeToken(creds)).rejects.toThrow('Token exchange failed');
  });
});

describe('fetchModels', () => {
  test('should fetch and map Anthropic models from Vertex AI', async () => {
    const vertexAi = createVertexAi();
    const models = await vertexAi.fetchModels('my-project', 'us-east5', 'test-token');

    expect(models).toEqual([{ label: 'claude-sonnet-4-20250514' }, { label: 'claude-haiku-3.5-20241022' }]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://us-east5-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-token',
          'x-goog-user-project': 'my-project',
        },
      }),
    );
  });

  test('should throw user-friendly error on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 403, message: 'Vertex AI API has not been enabled' } }), {
        status: 403,
      }),
    );

    const vertexAi = createVertexAi();
    await expect(vertexAi.fetchModels('my-project', 'us-east5', 'test-token')).rejects.toThrow(
      'Vertex AI API has not been enabled',
    );
  });

  test('should throw region-specific error on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));

    const vertexAi = createVertexAi();
    await expect(vertexAi.fetchModels('my-project', 'bad-region', 'test-token')).rejects.toThrow(
      'Region "bad-region" not found',
    );
  });

  test('should throw fallback on 403 without JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));

    const vertexAi = createVertexAi();
    await expect(vertexAi.fetchModels('my-project', 'us-east5', 'test-token')).rejects.toThrow(
      'Access denied for project "my-project"',
    );
  });

  test('should use non-prefixed host for global region', async () => {
    const vertexAi = createVertexAi();
    await vertexAi.fetchModels('my-project', 'global', 'test-token');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://aiplatform.googleapis.com/v1beta1/publishers/anthropic/models',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer test-token',
          'x-goog-user-project': 'my-project',
        },
      }),
    );
  });

  test('should handle empty model list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ publisherModels: [] }), { status: 200 }),
    );

    const vertexAi = createVertexAi();
    const models = await vertexAi.fetchModels('my-project', 'us-east5', 'test-token');
    expect(models).toEqual([]);
  });
});

describe('factory', () => {
  let create: (params: { [key: string]: unknown }, logger?: Logger) => Promise<void>;

  beforeEach(async () => {
    const vertexAi = createVertexAi();
    await vertexAi.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    assert(mock.mock.calls[0], 'setInferenceProviderConnectionFactory must be called');
    create = mock.mock.calls[0][0].create;
  });

  test('should throw when projectId is missing', async () => {
    await expect(create({})).rejects.toThrow('Project ID is required');
  });

  test('should throw when region is missing', async () => {
    await expect(create({ 'vertex-ai.factory.projectId': 'proj' })).rejects.toThrow('Region is required');
  });

  test('should throw when credentialsFile is missing', async () => {
    await expect(
      create({ 'vertex-ai.factory.projectId': 'proj', 'vertex-ai.factory.region': 'us-east5' }),
    ).rejects.toThrow('Credentials file is required');
  });

  test('should throw when credentials file does not exist', async () => {
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));

    await expect(
      create({
        'vertex-ai.factory.projectId': 'my-project',
        'vertex-ai.factory.region': 'us-east5',
        'vertex-ai.factory.credentialsFile': '/bad/path/creds.json',
      }),
    ).rejects.toThrow('Credentials file not found');
  });

  test('should throw when credentials are invalid', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ type: 'authorized_user' }));

    await expect(
      create({
        'vertex-ai.factory.projectId': 'my-project',
        'vertex-ai.factory.region': 'us-east5',
        'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
      }),
    ).rejects.toThrow('Invalid credentials file');
  });

  test('should throw when token exchange fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    await expect(
      create({
        'vertex-ai.factory.projectId': 'my-project',
        'vertex-ai.factory.region': 'us-east5',
        'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
      }),
    ).rejects.toThrow('Authentication failed');
  });

  test('should fall back to hardcoded models on 403 with API-not-enabled message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ error: { code: 403, message: 'Vertex AI API has not been enabled for project bad-project' } }),
        { status: 403 },
      );
    });

    await create({
      'vertex-ai.factory.projectId': 'bad-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        models: FALLBACK_MODELS,
      }),
    );
  });

  test('should throw region error when region does not exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response('Not Found', { status: 404 });
    });

    await expect(
      create({
        'vertex-ai.factory.projectId': 'my-project',
        'vertex-ai.factory.region': 'bad-region',
        'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
      }),
    ).rejects.toThrow('Region "bad-region" not found');
  });

  test('should fall back to hardcoded models on 403 (listing permission denied)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'mock-token', token_type: 'Bearer', expires_in: 3600 }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          error: {
            code: 403,
            message:
              'Caller does not have required permission to use project my-corp-project. Grant the caller the roles/serviceusage.serviceUsageConsumer role.',
          },
        }),
        { status: 403 },
      );
    });

    await create({
      'vertex-ai.factory.projectId': 'my-corp-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        models: FALLBACK_MODELS,
      }),
    );
  });

  test('should rollback saved config if registration fails', async () => {
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockImplementation(() => {
      throw new Error('registration boom');
    });

    await expect(
      create({
        'vertex-ai.factory.projectId': 'my-project',
        'vertex-ai.factory.region': 'us-east5',
        'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
      }),
    ).rejects.toThrow('registration boom');

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledTimes(3);
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenNthCalledWith(3, CONNECTIONS_KEY, '[]');
  });

  test('should reject duplicate connection for same project and region', async () => {
    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    const stored: StoredConnection[] = [
      {
        id: 'fake-uuid-1',
        projectId: 'my-project',
        region: 'us-east5',
        credentialsFile: '/home/user/.config/gcloud/application_default_credentials.json',
      },
    ];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));

    await expect(
      create({
        'vertex-ai.factory.projectId': 'my-project',
        'vertex-ai.factory.region': 'us-east5',
        'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
      }),
    ).rejects.toThrow('Connection already exists for project my-project in us-east5');
  });

  test('should save config as JSON with persisted ID and register connection', async () => {
    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    const expected: StoredConnection[] = [
      {
        id: 'fake-uuid-1',
        projectId: 'my-project',
        region: 'us-east5',
        credentialsFile: '/home/user/.config/gcloud/application_default_credentials.json',
      },
    ];
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(CONNECTIONS_KEY, JSON.stringify(expected));
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    expect(PROVIDER_MOCK.registerInferenceProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'fake-uuid-1',
        name: 'my-project (us-east5)',
        type: 'cloud',
        llmMetadata: { name: 'vertexai' },
        sdk: VERTEX_ANTHROPIC_MOCK,
        models: [{ label: 'claude-sonnet-4-20250514' }, { label: 'claude-haiku-3.5-20241022' }],
      }),
    );
  });

  test('should create SDK with correct options', async () => {
    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    expect(createVertexAnthropic).toHaveBeenCalledWith({
      project: 'my-project',
      location: 'us-east5',
      googleAuthOptions: {
        keyFilename: '/home/user/.config/gcloud/application_default_credentials.json',
      },
    });
  });
});

describe('connection delete lifecycle', () => {
  let mDelete: (logger?: Logger) => Promise<void>;
  const disposeMock = vi.fn();

  beforeEach(async () => {
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockReturnValue({
      dispose: disposeMock,
    } as unknown as Disposable);

    const vertexAi = createVertexAi();
    await vertexAi.init();

    const factoryMock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = factoryMock.mock.calls[0][0].create;

    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    const registerMock = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection);
    const lifecycle = registerMock.mock.calls[0][0].lifecycle;
    assert(lifecycle?.delete, 'delete method of lifecycle must be defined');

    mDelete = lifecycle.delete;
  });

  test('calling delete should update secrets, clear configuration, and dispose provider inference connection', async () => {
    await mDelete();

    expect(SECRET_STORAGE_MOCK.delete).toHaveBeenCalledWith(`${PROVIDER_ID}:fake-uuid-1:token`);

    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection._type', undefined);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection._needsInferenceSetup', undefined);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.GOOGLE_APPLICATION_CREDENTIALS', undefined);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_PROJECT_ID', undefined);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_REGION', undefined);

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
    const vertexAi = createVertexAi();
    await vertexAi.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(
      `${PROVIDER_ID}:fake-uuid-1:token`,
      '/home/user/.config/gcloud/application_default_credentials.json',
    );

    const connection = vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mock.calls[0][0];
    expect(CONFIGURATION_API_MOCK.getConfiguration).toHaveBeenCalledWith(undefined, connection);

    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection._type', OPENSHELL_PROVIDER_ID);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection._needsInferenceSetup', true);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith(
      'vertex-ai.connection.GOOGLE_APPLICATION_CREDENTIALS',
      `${PROVIDER_ID}:fake-uuid-1:token`,
    );
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_PROJECT_ID', 'my-project');
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_REGION', 'us-east5');
  });

  test('should expand tilde in credentials path when storing secret', async () => {
    const vertexAi = createVertexAi();
    await vertexAi.init();

    const mock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = mock.mock.calls[0][0].create;

    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '~/.config/gcloud/application_default_credentials.json',
    });

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(
      `${PROVIDER_ID}:fake-uuid-1:token`,
      join('/home/testuser', '.config/gcloud/application_default_credentials.json'),
    );
  });

  test('should set workspace configuration for each restored connection', async () => {
    const stored: StoredConnection[] = [
      { id: 'id-1', projectId: 'proj-a', region: 'us-east5', credentialsFile: '/path/a' },
      { id: 'id-2', projectId: 'proj-b', region: 'europe-west1', credentialsFile: '/path/b' },
    ];
    vi.mocked(SECRET_STORAGE_MOCK.get).mockResolvedValue(JSON.stringify(stored));

    const vertexAi = createVertexAi();
    await vertexAi.init();

    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(`${PROVIDER_ID}:id-1:token`, '/path/a');
    expect(SECRET_STORAGE_MOCK.store).toHaveBeenCalledWith(`${PROVIDER_ID}:id-2:token`, '/path/b');

    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection._type', OPENSHELL_PROVIDER_ID);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection._needsInferenceSetup', true);
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith(
      'vertex-ai.connection.GOOGLE_APPLICATION_CREDENTIALS',
      `${PROVIDER_ID}:id-1:token`,
    );
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith(
      'vertex-ai.connection.GOOGLE_APPLICATION_CREDENTIALS',
      `${PROVIDER_ID}:id-2:token`,
    );
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_PROJECT_ID', 'proj-a');
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_PROJECT_ID', 'proj-b');
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_REGION', 'us-east5');
    expect(CONFIG_UPDATE_MOCK).toHaveBeenCalledWith('vertex-ai.connection.VERTEX_AI_REGION', 'europe-west1');
  });
});

describe('dispose', () => {
  test('should dispose provider and all connections', async () => {
    const disposeMock = vi.fn();
    vi.mocked(PROVIDER_MOCK.registerInferenceProviderConnection).mockReturnValue({
      dispose: disposeMock,
    } as unknown as Disposable);

    const vertexAi = createVertexAi();
    await vertexAi.init();

    const factoryMock = vi.mocked(PROVIDER_MOCK.setInferenceProviderConnectionFactory);
    const create = factoryMock.mock.calls[0][0].create;

    await create({
      'vertex-ai.factory.projectId': 'my-project',
      'vertex-ai.factory.region': 'us-east5',
      'vertex-ai.factory.credentialsFile': '/home/user/.config/gcloud/application_default_credentials.json',
    });

    vertexAi.dispose();

    expect(PROVIDER_MOCK.dispose).toHaveBeenCalledOnce();
    expect(disposeMock).toHaveBeenCalledOnce();
  });
});
