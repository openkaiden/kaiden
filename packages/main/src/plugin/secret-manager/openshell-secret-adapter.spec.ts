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

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { beforeEach, describe, expect, type Mock, test, vi } from 'vitest';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

import { OpenshellSecretAdapter, readGcloudAdc } from './openshell-secret-adapter.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}));

let adapter: OpenshellSecretAdapter;
let mockRaw: {
  createProvider: Mock;
  listProviders: Mock;
  deleteProvider: Mock;
  listProviderProfiles: Mock;
  getProviderProfile: Mock;
  configureProviderRefresh: Mock;
  rotateProviderCredential: Mock;
};
let sdkClientManager: OpenshellSdkClientManager;

beforeEach(() => {
  vi.resetAllMocks();
  mockRaw = {
    createProvider: vi.fn(),
    listProviders: vi.fn(),
    deleteProvider: vi.fn(),
    listProviderProfiles: vi.fn(),
    getProviderProfile: vi.fn(),
    configureProviderRefresh: vi.fn(),
    rotateProviderCredential: vi.fn(),
  };
  const mockClient = { raw: mockRaw } as unknown as OpenShellClient;
  sdkClientManager = new OpenshellSdkClientManager(undefined!, undefined!);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient);
  adapter = new OpenshellSecretAdapter(sdkClientManager);
});

describe('createSecret', () => {
  const defaultOptions: SecretCreateOptions = {
    name: 'my-secret',
    type: 'github',
    value: {
      credentials: {
        GH_TOKEN: 'ghp_abc123',
      },
    },
  };

  test('delegates to client.raw.createProvider and returns the secret name', async () => {
    mockRaw.createProvider.mockResolvedValue({});

    const result = await adapter.createSecret(defaultOptions);

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'my-secret' },
        type: 'github',
        credentials: { GH_TOKEN: 'ghp_abc123' },
        config: {},
      },
      workspace: '',
    });
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('rejects when client.raw.createProvider fails', async () => {
    mockRaw.createProvider.mockRejectedValue(new Error('provider type not supported'));

    await expect(adapter.createSecret(defaultOptions)).rejects.toThrow('provider type not supported');
  });

  test('creates secret on the selected gateway', async () => {
    mockRaw.createProvider.mockResolvedValue({});

    await adapter.createSecret(defaultOptions, 'remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('passes config through to createProvider', async () => {
    mockRaw.createProvider.mockResolvedValue({});

    const options: SecretCreateOptions = {
      name: 'my-vertex',
      type: 'google-vertex-ai',
      value: {
        credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' },
        config: { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_VERTEX_LOCATION: 'us-east5' },
      },
    };

    const result = await adapter.createSecret(options);

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'my-vertex' },
        type: 'google-vertex-ai',
        credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' },
        config: { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_VERTEX_LOCATION: 'us-east5' },
      },
      workspace: '',
    });
    expect(result).toEqual({ name: 'my-vertex' });
  });

  test('rejects when options.value is a string', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: 'plain-string',
    };

    await expect(adapter.createSecret(options)).rejects.toThrow('options.value must be a record for Openshell');
  });

  test('rejects when credentials are empty and no flags', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: {} },
    };

    await expect(adapter.createSecret(options)).rejects.toThrow('credentials must not be empty');
  });

  test('rejects unsupported CLI flags', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: {}, flags: ['--from-existing'] },
    };

    await expect(adapter.createSecret(options)).rejects.toThrow('Unsupported CLI flags');
  });
});

describe('createSecret with --from-gcloud-adc', () => {
  const adcOptions: SecretCreateOptions = {
    name: 'my-gcp',
    type: 'google-vertex-ai',
    value: {
      credentials: {},
      flags: ['--from-gcloud-adc'],
    },
  };

  beforeEach(async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        refresh_token: 'test-refresh-token',
      }),
    );

    mockRaw.getProviderProfile.mockResolvedValue({
      profile: {
        credentials: [
          {
            name: 'api_key',
            envVars: ['GOOGLE_API_KEY'],
            refresh: { strategy: 3 },
          },
        ],
      },
    });
    mockRaw.createProvider.mockResolvedValue({});
    mockRaw.configureProviderRefresh.mockResolvedValue({});
    mockRaw.rotateProviderCredential.mockResolvedValue({});
  });

  test('performs the 3-step gcloud ADC flow', async () => {
    const result = await adapter.createSecret(adcOptions);

    expect(mockRaw.getProviderProfile).toHaveBeenCalledWith({ id: 'google-vertex-ai', workspace: '' });
    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'my-gcp' },
        type: 'google-vertex-ai',
        config: {},
      },
      workspace: '',
    });
    expect(mockRaw.configureProviderRefresh).toHaveBeenCalledWith({
      provider: 'my-gcp',
      credentialKey: 'GOOGLE_API_KEY',
      strategy: 3,
      material: {
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        refresh_token: 'test-refresh-token',
      },
      secretMaterialKeys: ['client_secret', 'refresh_token'],
      workspace: '',
    });
    expect(mockRaw.rotateProviderCredential).toHaveBeenCalledWith({
      provider: 'my-gcp',
      credentialKey: 'GOOGLE_API_KEY',
      workspace: '',
    });
    expect(result).toEqual({ name: 'my-gcp' });
  });

  test('rolls back provider on configureProviderRefresh failure', async () => {
    mockRaw.configureProviderRefresh.mockRejectedValue(new Error('configure failed'));
    mockRaw.deleteProvider.mockResolvedValue({});

    await expect(adapter.createSecret(adcOptions)).rejects.toThrow('configure failed');
    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({ name: 'my-gcp', workspace: '' });
  });

  test('rolls back provider on rotateProviderCredential failure', async () => {
    mockRaw.rotateProviderCredential.mockRejectedValue(new Error('rotate failed'));
    mockRaw.deleteProvider.mockResolvedValue({});

    await expect(adapter.createSecret(adcOptions)).rejects.toThrow('rotate failed');
    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({ name: 'my-gcp', workspace: '' });
  });

  test('rejects when provider profile has no ADC credential', async () => {
    mockRaw.getProviderProfile.mockResolvedValue({
      profile: { credentials: [{ name: 'api_key', envVars: ['KEY'], refresh: { strategy: 1 } }] },
    });

    await expect(adapter.createSecret(adcOptions)).rejects.toThrow('not supported');
  });
});

describe('listSecrets', () => {
  test('maps providers to SecretInfo array', async () => {
    mockRaw.listProviders.mockResolvedValue({
      providers: [
        { metadata: { name: 'my-openai' }, type: 'openai' },
        { metadata: { name: 'my-anthropic' }, type: 'anthropic' },
      ],
    });

    const result = await adapter.listSecrets();

    expect(mockRaw.listProviders).toHaveBeenCalledWith({ workspace: '' });
    expect(result).toEqual([
      { name: 'my-openai', type: 'openai' },
      { name: 'my-anthropic', type: 'anthropic' },
    ]);
  });

  test('returns empty array when no providers exist', async () => {
    mockRaw.listProviders.mockResolvedValue({ providers: [] });

    const result = await adapter.listSecrets();

    expect(result).toEqual([]);
  });

  test('lists secrets from the selected gateway', async () => {
    mockRaw.listProviders.mockResolvedValue({ providers: [] });

    await adapter.listSecrets('remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('rejects when client.raw.listProviders fails', async () => {
    mockRaw.listProviders.mockRejectedValue(new Error('no gateway configured'));

    await expect(adapter.listSecrets()).rejects.toThrow('no gateway configured');
  });
});

describe('removeSecret', () => {
  test('delegates to client.raw.deleteProvider and returns the secret name', async () => {
    mockRaw.deleteProvider.mockResolvedValue({});

    const result = await adapter.removeSecret('my-openai');

    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({ name: 'my-openai', workspace: '' });
    expect(result).toEqual({ name: 'my-openai' });
  });

  test('removes secret from the selected gateway', async () => {
    mockRaw.deleteProvider.mockResolvedValue({});

    await adapter.removeSecret('my-openai', 'remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('rejects when client.raw.deleteProvider fails', async () => {
    mockRaw.deleteProvider.mockRejectedValue(new Error('provider not found: unknown'));

    await expect(adapter.removeSecret('unknown')).rejects.toThrow('provider not found: unknown');
  });
});

describe('listServices', () => {
  test('delegates to client.raw.listProviderProfiles and maps fields', async () => {
    mockRaw.listProviderProfiles.mockResolvedValue({
      profiles: [
        {
          id: 'openai',
          displayName: 'OpenAI',
          description: 'OpenAI API provider',
          credentials: [{ name: 'api_key', required: true, description: '', envVars: ['OPENAI_API_KEY'] }],
        },
        {
          id: 'anthropic',
          displayName: 'Anthropic',
          description: '',
          credentials: [{ name: 'api_key', required: true, description: 'API key', envVars: [] }],
        },
      ],
    });

    const result = await adapter.listServices();

    expect(mockRaw.listProviderProfiles).toHaveBeenCalledWith({ workspace: '' });
    expect(result).toEqual([
      {
        id: 'openai',
        display_name: 'OpenAI',
        description: 'OpenAI API provider',
        credentials: [{ name: 'api_key', required: true, description: undefined, env_vars: ['OPENAI_API_KEY'] }],
      },
      {
        id: 'anthropic',
        display_name: 'Anthropic',
        description: undefined,
        credentials: [{ name: 'api_key', required: true, description: 'API key', env_vars: undefined }],
      },
    ]);
  });

  test('returns empty array when no profiles exist', async () => {
    mockRaw.listProviderProfiles.mockResolvedValue({ profiles: [] });

    const result = await adapter.listServices();

    expect(result).toEqual([]);
  });

  test('rejects when client.raw.listProviderProfiles fails', async () => {
    mockRaw.listProviderProfiles.mockRejectedValue(new Error('no gateway configured'));

    await expect(adapter.listServices()).rejects.toThrow('no gateway configured');
  });
});

describe('readGcloudAdc', () => {
  test('rejects for service account type', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        type: 'service_account',
        client_id: 'id',
        client_secret: 'secret',
        refresh_token: 'token',
      }),
    );

    await expect(readGcloudAdc()).rejects.toThrow('only "authorized_user" is supported');
  });

  test('rejects when file cannot be read', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(readGcloudAdc()).rejects.toThrow('Could not read gcloud ADC file');
  });

  test('rejects when client_id is missing', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        type: 'authorized_user',
        client_secret: 'secret',
        refresh_token: 'token',
      }),
    );

    await expect(readGcloudAdc()).rejects.toThrow('missing or has an empty "client_id"');
  });
});
