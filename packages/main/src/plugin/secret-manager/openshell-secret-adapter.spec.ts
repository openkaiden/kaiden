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

import { create } from '@bufbuild/protobuf';
import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { NetworkEndpointSchema } from '@nvidia/openshell-sdk/raw';
import { beforeEach, describe, expect, type Mock, test, vi } from 'vitest';

import { OpenshellNetworkPolicy } from '/@/plugin/openshell-cli/openshell-network-policy.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import type { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import { DEFAULT_WORKSPACE, WORKSPACE_SCOPE } from '/@api/openshell-gateway-info.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

import { DefaultProviderFactory } from './default-provider-factory.js';
import { GcloudAdcProviderFactory } from './gcloud-adc-provider-factory.js';
import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));

let adapter: OpenshellSecretAdapter;
let mockRaw: {
  createProvider: Mock;
  listProviders: Mock;
  deleteProvider: Mock;
  listProviderProfiles: Mock;
  importProviderProfiles: Mock;
  deleteProviderProfile: Mock;
};
let sdkClientManager: OpenshellSdkClientManager;
let defaultFactory: DefaultProviderFactory;
let gcloudFactory: GcloudAdcProviderFactory;
const openshellNetworkPolicy = new OpenshellNetworkPolicy();
let openshellRegistry: OpenShellRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  mockRaw = {
    createProvider: vi.fn(),
    listProviders: vi.fn(),
    deleteProvider: vi.fn(),
    listProviderProfiles: vi.fn(),
    importProviderProfiles: vi.fn(),
    deleteProviderProfile: vi.fn(),
  };
  const mockClient = { raw: mockRaw } as unknown as OpenShellClient;
  sdkClientManager = new OpenshellSdkClientManager(undefined!, undefined!);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient);

  defaultFactory = new DefaultProviderFactory();
  gcloudFactory = new GcloudAdcProviderFactory();
  vi.spyOn(defaultFactory, 'createProvider').mockResolvedValue(undefined);
  vi.spyOn(gcloudFactory, 'createProvider').mockResolvedValue(undefined);

  openshellRegistry = {
    getProfiles: vi.fn().mockReturnValue([]),
  } as unknown as OpenShellRegistry;

  adapter = new OpenshellSecretAdapter(
    sdkClientManager,
    [gcloudFactory],
    defaultFactory,
    openshellNetworkPolicy,
    openshellRegistry,
  );
});

describe('createSecret', () => {
  test('delegates to DefaultProviderFactory and returns the secret name', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: { GH_TOKEN: 'ghp_abc123' } },
    };

    const result = await adapter.createSecret(options);

    expect(defaultFactory.createProvider).toHaveBeenCalledWith(expect.anything(), options);
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('delegates to GcloudAdcProviderFactory when type is google-vertex-ai', async () => {
    const options: SecretCreateOptions = {
      name: 'my-gcp',
      type: 'google-vertex-ai',
      value: { credentials: {} },
    };

    const result = await adapter.createSecret(options);

    expect(gcloudFactory.createProvider).toHaveBeenCalledWith(expect.anything(), options);
    expect(defaultFactory.createProvider).not.toHaveBeenCalled();
    expect(result).toEqual({ name: 'my-gcp' });
  });

  test('creates secret on the selected gateway', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: { GH_TOKEN: 'ghp_abc123' } },
    };

    await adapter.createSecret(options, 'remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('rejects when options.value is a string', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: 'plain-string',
    };

    await expect(adapter.createSecret(options)).rejects.toThrow('options.value must be a record for Openshell');
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

    expect(mockRaw.listProviders).toHaveBeenCalledWith({
      workspaceScope: {
        selection: {
          case: WORKSPACE_SCOPE,
          value: DEFAULT_WORKSPACE,
        },
      },
    });
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

    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({
      name: 'my-openai',
      workspaceScope: {
        selection: {
          case: WORKSPACE_SCOPE,
          value: DEFAULT_WORKSPACE,
        },
      },
    });
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

    expect(mockRaw.listProviderProfiles).toHaveBeenCalledWith({
      workspaceScope: {
        selection: {
          case: WORKSPACE_SCOPE,
          value: DEFAULT_WORKSPACE,
        },
      },
    });
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

describe('createProfile', () => {
  test('cloned profile keeps base endpoints when no endpoint option is provided', async () => {
    const baseEndpoints = [create(NetworkEndpointSchema, { host: 'api.openai.com', port: 443 })];
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [], endpoints: baseEndpoints },
    ] as never);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await adapter.createProfile({ name: 'openai-claude', from: 'openai', binaries: ['/**/claude'] });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: baseEndpoints,
            }),
          }),
        ],
      }),
    );
  });

  test('appends parsed endpoint to cloned profile endpoints', async () => {
    const baseEndpoints = [{ host: 'api.openai.com', port: 443 }];
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [], endpoints: baseEndpoints },
    ] as never);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await adapter.createProfile({
      name: 'openai-claude',
      from: 'openai',
      binaries: ['/**/claude'],
      endpoint: 'http://localhost:11434/v1',
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: expect.arrayContaining([
                ...baseEndpoints,
                expect.objectContaining({
                  host: 'host.openshell.internal',
                  port: 11434,
                  protocol: 'rest',
                }),
              ]),
            }),
          }),
        ],
      }),
    );
  });

  test('does not modify endpoints when endpoint URL is invalid', async () => {
    const baseEndpoints = [create(NetworkEndpointSchema, { host: 'api.openai.com', port: 443 })];
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [], endpoints: baseEndpoints },
    ] as never);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await adapter.createProfile({
      name: 'openai-claude',
      from: 'openai',
      binaries: ['/**/claude'],
      endpoint: 'not-a-url',
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: baseEndpoints,
            }),
          }),
        ],
      }),
    );
  });

  test('skips adding endpoint when existing endpoint matches exactly', async () => {
    const baseEndpoints = [create(NetworkEndpointSchema, { host: 'api.openai.com', port: 443 })];
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [], endpoints: baseEndpoints },
    ] as never);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await adapter.createProfile({
      name: 'openai-clone',
      from: 'openai',
      binaries: ['/**/claude'],
      endpoint: 'https://api.openai.com/v1',
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: baseEndpoints,
            }),
          }),
        ],
      }),
    );
  });

  test('skips adding endpoint when existing wildcard host covers it', async () => {
    const baseEndpoints = [create(NetworkEndpointSchema, { host: '*', port: 443 })];
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [], endpoints: baseEndpoints },
    ] as never);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await adapter.createProfile({
      name: 'openai-clone',
      from: 'openai',
      binaries: ['/**/claude'],
      endpoint: 'https://api.openai.com/v1',
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: baseEndpoints,
            }),
          }),
        ],
      }),
    );
  });

  test('adds endpoint when host matches but port differs', async () => {
    const baseEndpoints = [{ host: 'api.openai.com', port: 80 }];
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [], endpoints: baseEndpoints },
    ] as never);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await adapter.createProfile({
      name: 'openai-clone',
      from: 'openai',
      binaries: ['/**/claude'],
      endpoint: 'https://api.openai.com/v1',
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: expect.arrayContaining([
                ...baseEndpoints,
                expect.objectContaining({
                  host: 'api.openai.com',
                  port: 443,
                }),
              ]),
            }),
          }),
        ],
      }),
    );
  });

  test('throws when base profile is not found in registry', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([]);

    await expect(
      adapter.createProfile({ name: 'openai-claude', from: 'openai', binaries: ['/**/claude'] }),
    ).rejects.toThrow('Provider profile "openai" not found');
  });
});

describe('deleteProfile', () => {
  test('delegates to client.raw.deleteProviderProfile with allowMissing', async () => {
    mockRaw.deleteProviderProfile.mockResolvedValue({});

    await adapter.deleteProfile('my-sandbox-uuid');

    expect(mockRaw.deleteProviderProfile).toHaveBeenCalledWith({
      id: 'my-sandbox-uuid',
      allowMissing: true,
      workspaceScope: {
        selection: {
          case: WORKSPACE_SCOPE,
          value: DEFAULT_WORKSPACE,
        },
      },
    });
  });

  test('deletes profile from the selected gateway', async () => {
    mockRaw.deleteProviderProfile.mockResolvedValue({});

    await adapter.deleteProfile('my-sandbox-uuid', 'remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });
});
