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

import type { SecretCreateOptions } from '/@api/secret-info.js';

import { GcloudAdcProviderFactory, readGcloudAdc } from './gcloud-adc-provider-factory.js';

vi.mock(import('node:fs/promises'), () => ({
  readFile: vi.fn(),
}));

let factory: GcloudAdcProviderFactory;
let mockRaw: {
  createProvider: Mock;
  deleteProvider: Mock;
  getProviderProfile: Mock;
  configureProviderRefresh: Mock;
  rotateProviderCredential: Mock;
};
let client: OpenShellClient;

const adcOptions: SecretCreateOptions = {
  name: 'my-gcp',
  type: 'google-vertex-ai',
  value: {
    credentials: {},
  },
};

beforeEach(async () => {
  vi.resetAllMocks();
  mockRaw = {
    createProvider: vi.fn().mockResolvedValue({}),
    deleteProvider: vi.fn().mockResolvedValue({}),
    getProviderProfile: vi.fn(),
    configureProviderRefresh: vi.fn().mockResolvedValue({}),
    rotateProviderCredential: vi.fn().mockResolvedValue({}),
  };
  client = { raw: mockRaw } as unknown as OpenShellClient;
  factory = new GcloudAdcProviderFactory();

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
});

describe('createProvider', () => {
  test('performs the 3-step gcloud ADC flow', async () => {
    await factory.createProvider(client, adcOptions);

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
  });

  test('rolls back provider on configureProviderRefresh failure', async () => {
    mockRaw.configureProviderRefresh.mockRejectedValue(new Error('configure failed'));

    await expect(factory.createProvider(client, adcOptions)).rejects.toThrow('configure failed');
    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({ name: 'my-gcp', workspace: '' });
  });

  test('rolls back provider on rotateProviderCredential failure', async () => {
    mockRaw.rotateProviderCredential.mockRejectedValue(new Error('rotate failed'));

    await expect(factory.createProvider(client, adcOptions)).rejects.toThrow('rotate failed');
    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({ name: 'my-gcp', workspace: '' });
  });

  test('rejects when provider profile has no ADC credential', async () => {
    mockRaw.getProviderProfile.mockResolvedValue({
      profile: { credentials: [{ name: 'api_key', envVars: ['KEY'], refresh: { strategy: 1 } }] },
    });

    await expect(factory.createProvider(client, adcOptions)).rejects.toThrow('not supported');
  });

  test('passes config through from options', async () => {
    const optionsWithConfig: SecretCreateOptions = {
      name: 'my-gcp',
      type: 'google-vertex-ai',
      value: {
        credentials: {},
        config: { GOOGLE_VERTEX_PROJECT: 'my-project' },
      },
    };

    await factory.createProvider(client, optionsWithConfig);

    expect(mockRaw.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ config: { GOOGLE_VERTEX_PROJECT: 'my-project' } }),
      }),
    );
  });

  test('reads ADC file from credentials GOOGLE_APPLICATION_CREDENTIALS path', async () => {
    const { readFile } = await import('node:fs/promises');
    const optionsWithCreds: SecretCreateOptions = {
      name: 'my-gcp',
      type: 'google-vertex-ai',
      value: {
        credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/custom/path/adc.json' },
      },
    };

    await factory.createProvider(client, optionsWithCreds);

    expect(readFile).toHaveBeenCalledWith('/custom/path/adc.json', 'utf-8');
  });
});

describe('supports', () => {
  test('returns true for google-vertex-ai', () => {
    expect(factory.supports('google-vertex-ai')).toBe(true);
  });

  test('returns false for other types', () => {
    expect(factory.supports('cursor')).toBe(false);
    expect(factory.supports('openai')).toBe(false);
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
