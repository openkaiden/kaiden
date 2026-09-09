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

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type { Exec } from '/@/plugin/util/exec.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-cli.js'));

let adapter: OpenshellSecretAdapter;
const openshellCli = new OpenshellCli({} as Exec, {} as CliToolRegistry);

beforeEach(() => {
  vi.resetAllMocks();
  adapter = new OpenshellSecretAdapter(openshellCli);
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

  test('delegates to openshellCli.createProvider and returns the secret name', async () => {
    vi.mocked(openshellCli.createProvider).mockResolvedValue(undefined);

    const result = await adapter.createSecret(defaultOptions);

    expect(openshellCli.createProvider).toHaveBeenCalledWith(
      {
        name: 'my-secret',
        type: 'github',
        credentials: { GH_TOKEN: 'ghp_abc123' },
        config: undefined,
        flags: undefined,
      },
      undefined,
    );
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('rejects when openshellCli.createProvider fails', async () => {
    vi.mocked(openshellCli.createProvider).mockRejectedValue(new Error('provider type not supported'));

    await expect(adapter.createSecret(defaultOptions)).rejects.toThrow('provider type not supported');
  });

  test('creates secret on the selected gateway', async () => {
    vi.mocked(openshellCli.createProvider).mockResolvedValue(undefined);

    await adapter.createSecret(defaultOptions, 'remote');

    expect(openshellCli.createProvider).toHaveBeenCalledWith(expect.any(Object), 'remote');
  });

  test('passes config and flags through to createProvider', async () => {
    vi.mocked(openshellCli.createProvider).mockResolvedValue(undefined);

    const options: SecretCreateOptions = {
      name: 'my-vertex',
      type: 'google-vertex-ai',
      value: {
        credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' },
        config: { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_VERTEX_LOCATION: 'us-east5' },
        flags: ['--from-gcloud-adc'],
      },
    };

    const result = await adapter.createSecret(options);

    expect(openshellCli.createProvider).toHaveBeenCalledWith(
      {
        name: 'my-vertex',
        type: 'google-vertex-ai',
        credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' },
        config: { GOOGLE_VERTEX_PROJECT: 'my-project', GOOGLE_VERTEX_LOCATION: 'us-east5' },
        flags: ['--from-gcloud-adc'],
      },
      undefined,
    );
    expect(result).toEqual({ name: 'my-vertex' });
  });
});

describe('listSecrets', () => {
  test('maps providers to SecretInfo array', async () => {
    vi.mocked(openshellCli.listProviders).mockResolvedValue([
      { name: 'my-openai', type: 'openai' },
      { name: 'my-anthropic', type: 'anthropic' },
    ]);

    const result = await adapter.listSecrets();

    expect(openshellCli.listProviders).toHaveBeenCalled();
    expect(result).toEqual([
      { name: 'my-openai', type: 'openai' },
      { name: 'my-anthropic', type: 'anthropic' },
    ]);
  });

  test('returns empty array when no providers exist', async () => {
    vi.mocked(openshellCli.listProviders).mockResolvedValue([]);

    const result = await adapter.listSecrets();

    expect(result).toEqual([]);
  });

  test('lists secrets from the selected gateway', async () => {
    vi.mocked(openshellCli.listProviders).mockResolvedValue([]);

    await adapter.listSecrets('remote');

    expect(openshellCli.listProviders).toHaveBeenCalledWith('remote');
  });

  test('rejects when openshellCli.listProviders fails', async () => {
    vi.mocked(openshellCli.listProviders).mockRejectedValue(new Error('no gateway configured'));

    await expect(adapter.listSecrets()).rejects.toThrow('no gateway configured');
  });
});

describe('removeSecret', () => {
  test('delegates to openshellCli.deleteProvider and returns the secret name', async () => {
    vi.mocked(openshellCli.deleteProvider).mockResolvedValue(undefined);

    const result = await adapter.removeSecret('my-openai');

    expect(openshellCli.deleteProvider).toHaveBeenCalledWith('my-openai', undefined);
    expect(result).toEqual({ name: 'my-openai' });
  });

  test('rejects when openshellCli.deleteProvider fails', async () => {
    vi.mocked(openshellCli.deleteProvider).mockRejectedValue(new Error('provider not found: unknown'));

    await expect(adapter.removeSecret('unknown')).rejects.toThrow('provider not found: unknown');
  });
});

describe('listServices', () => {
  test('delegates to openshellCli.listProfiles', async () => {
    const profiles = [
      {
        id: 'openai',
        display_name: 'OpenAI',
        description: 'OpenAI API provider',
        credentials: [{ name: 'api_key', required: true, env_vars: ['OPENAI_API_KEY'] }],
      },
      {
        id: 'anthropic',
        display_name: 'Anthropic',
        credentials: [{ name: 'api_key', required: true, env_vars: ['ANTHROPIC_API_KEY'] }],
      },
    ];
    vi.mocked(openshellCli.listProfiles).mockResolvedValue(profiles);

    const result = await adapter.listServices();

    expect(openshellCli.listProfiles).toHaveBeenCalled();
    expect(result).toEqual(profiles);
  });

  test('returns empty array when no profiles exist', async () => {
    vi.mocked(openshellCli.listProfiles).mockResolvedValue([]);

    const result = await adapter.listServices();

    expect(result).toEqual([]);
  });

  test('rejects when openshellCli.listProfiles fails', async () => {
    vi.mocked(openshellCli.listProfiles).mockRejectedValue(new Error('no gateway configured'));

    await expect(adapter.listServices()).rejects.toThrow('no gateway configured');
  });
});
