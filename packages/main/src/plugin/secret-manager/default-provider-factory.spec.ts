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

import { DefaultProviderFactory } from './default-provider-factory.js';

let factory: DefaultProviderFactory;
let mockRaw: { createProvider: Mock };
let client: OpenShellClient;

beforeEach(() => {
  vi.resetAllMocks();
  mockRaw = { createProvider: vi.fn().mockResolvedValue({}) };
  client = { raw: mockRaw } as unknown as OpenShellClient;
  factory = new DefaultProviderFactory();
});

describe('createProvider', () => {
  test('calls client.raw.createProvider with credentials and config', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: {
        credentials: { GH_TOKEN: 'ghp_abc123' },
        config: { ORG: 'acme' },
      },
    };

    await factory.createProvider(client, options);

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'my-secret' },
        type: 'github',
        credentials: { GH_TOKEN: 'ghp_abc123' },
        config: { ORG: 'acme' },
      },
      workspace: '',
    });
  });

  test('defaults config to empty object when not provided', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: { GH_TOKEN: 'ghp_abc123' } },
    };

    await factory.createProvider(client, options);

    expect(mockRaw.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ config: {} }),
      }),
    );
  });

  test('rejects when options.value is a string', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: 'plain-string',
    };

    await expect(factory.createProvider(client, options)).rejects.toThrow(
      'options.value must be a record for Openshell',
    );
  });

  test('rejects when credentials are empty', async () => {
    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: {} },
    };

    await expect(factory.createProvider(client, options)).rejects.toThrow('credentials must not be empty');
  });

  test('propagates RPC errors', async () => {
    mockRaw.createProvider.mockRejectedValue(new Error('provider type not supported'));

    const options: SecretCreateOptions = {
      name: 'my-secret',
      type: 'github',
      value: { credentials: { GH_TOKEN: 'ghp_abc123' } },
    };

    await expect(factory.createProvider(client, options)).rejects.toThrow('provider type not supported');
  });
});
