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

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ProviderCredentialRefreshStrategy } from '@nvidia/openshell-sdk/raw';
import { inject, injectable } from 'inversify';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import type { OpenshellProfile } from '/@api/openshell-gateway-info.js';
import type { SecretCliBackend, SecretCreateOptions, SecretInfo, SecretName } from '/@api/secret-info.js';

const FROM_GCLOUD_ADC = '--from-gcloud-adc';

/**
 * Adapts {@link OpenshellSdkClientManager} gateway-level provider RPCs to the
 * {@link SecretCliBackend} interface used by {@link SecretManager}.
 *
 * OpenShell manages credentials as "providers" rather than "secrets".
 * This adapter maps:
 *   - `createSecret`  → `client.raw.createProvider`
 *   - `listSecrets`   → `client.raw.listProviders`
 *   - `removeSecret`  → `client.raw.deleteProvider`
 *   - `listServices`  → `client.raw.listProviderProfiles`
 */
@injectable()
export class OpenshellSecretAdapter implements SecretCliBackend {
  constructor(
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
  ) {}

  async createSecret(options: SecretCreateOptions, gateway?: string): Promise<SecretName> {
    if (typeof options.value === 'string') {
      throw new Error('options.value must be a record for Openshell');
    }
    const client = await this.sdkClientManager.getClient(gateway);
    const flags = options.value.flags;

    if (flags?.some(f => f !== FROM_GCLOUD_ADC)) {
      const unsupported = flags.filter(f => f !== FROM_GCLOUD_ADC);
      throw new Error(`Unsupported CLI flags for SDK path: ${unsupported.join(', ')}`);
    }

    if (flags?.includes(FROM_GCLOUD_ADC)) {
      await this.#createProviderWithGcloudAdc(client, options);
    } else {
      if (Object.keys(options.value.credentials).length === 0) {
        throw new Error('credentials must not be empty');
      }
      await client.raw.createProvider({
        provider: {
          metadata: { name: options.name },
          type: options.type,
          credentials: options.value.credentials,
          config: options.value.config ?? {},
        },
        workspace: '',
      });
    }
    return { name: options.name };
  }

  async listSecrets(gateway?: string): Promise<SecretInfo[]> {
    const client = await this.sdkClientManager.getClient(gateway);
    const response = await client.raw.listProviders({ workspace: '' });
    return response.providers.map(p => ({
      name: p.metadata?.name ?? '',
      type: p.type,
    }));
  }

  async removeSecret(name: string, gateway?: string): Promise<SecretName> {
    const client = await this.sdkClientManager.getClient(gateway);
    await client.raw.deleteProvider({ name, workspace: '' });
    return { name };
  }

  async listServices(): Promise<OpenshellProfile[]> {
    const client = await this.sdkClientManager.getClient();
    const response = await client.raw.listProviderProfiles({ workspace: '' });
    return response.profiles.map(p => ({
      id: p.id,
      display_name: p.displayName,
      description: p.description || undefined,
      credentials: p.credentials.map(c => ({
        name: c.name,
        required: c.required,
        description: c.description || undefined,
        env_vars: c.envVars.length > 0 ? c.envVars : undefined,
      })),
    }));
  }

  async #createProviderWithGcloudAdc(
    client: Awaited<ReturnType<OpenshellSdkClientManager['getClient']>>,
    options: SecretCreateOptions,
  ): Promise<void> {
    const { clientId, clientSecret, refreshToken } = await readGcloudAdc();

    const profileResponse = await client.raw.getProviderProfile({ id: options.type, workspace: '' });
    const adcCredential = profileResponse.profile?.credentials.find(
      c => c.refresh?.strategy === ProviderCredentialRefreshStrategy.OAUTH2_REFRESH_TOKEN,
    );
    if (!adcCredential) {
      throw new Error(`--from-gcloud-adc is not supported for '${options.type}' providers`);
    }
    const credentialKey = adcCredential.envVars[0];
    if (!credentialKey) {
      throw new Error(`ADC credential in '${options.type}' profile has no env_vars declared`);
    }

    const value = options.value;
    await client.raw.createProvider({
      provider: {
        metadata: { name: options.name },
        type: options.type,
        config: typeof value !== 'string' ? (value.config ?? {}) : {},
      },
      workspace: '',
    });

    try {
      await client.raw.configureProviderRefresh({
        provider: options.name,
        credentialKey,
        strategy: ProviderCredentialRefreshStrategy.OAUTH2_REFRESH_TOKEN,
        material: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        },
        secretMaterialKeys: ['client_secret', 'refresh_token'],
        workspace: '',
      });

      await client.raw.rotateProviderCredential({
        provider: options.name,
        credentialKey,
        workspace: '',
      });
    } catch (error: unknown) {
      await client.raw.deleteProvider({ name: options.name, workspace: '' }).catch(() => {});
      throw error;
    }
  }
}

interface GcloudAdcCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function readGcloudAdc(): Promise<GcloudAdcCredentials> {
  const path = resolveGcloudAdcPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new Error(`Could not read gcloud ADC file at ${path}`);
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed['type'] !== 'authorized_user') {
    throw new Error(
      `Unsupported gcloud ADC credential type '${String(parsed['type'])}'; ` +
        'only "authorized_user" is supported. For service accounts, use the appropriate credential mechanism.',
    );
  }

  const clientId = parsed['client_id'];
  const clientSecret = parsed['client_secret'];
  const refreshToken = parsed['refresh_token'];
  if (typeof clientId !== 'string' || !clientId) {
    throw new Error('gcloud ADC file is missing or has an empty "client_id"');
  }
  if (typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error('gcloud ADC file is missing or has an empty "client_secret"');
  }
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('gcloud ADC file is missing or has an empty "refresh_token"');
  }
  return { clientId, clientSecret, refreshToken };
}

function resolveGcloudAdcPath(): string {
  const envPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  if (envPath) return envPath;

  const configDir = process.env['CLOUDSDK_CONFIG'];
  if (configDir) return join(configDir, 'application_default_credentials.json');

  return join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}
