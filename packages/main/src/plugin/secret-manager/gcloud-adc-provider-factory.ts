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
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { ProviderCredentialRefreshStrategy } from '@nvidia/openshell-sdk/raw';
import { injectable } from 'inversify';

import type { SecretCreateOptions } from '/@api/secret-info.js';

import type { SelectableProviderFactory } from './provider-factory.js';

@injectable()
export class GcloudAdcProviderFactory implements SelectableProviderFactory {
  supports(type: string): boolean {
    return type === 'google-vertex-ai';
  }

  async createProvider(client: OpenShellClient, options: SecretCreateOptions): Promise<void> {
    const credentials = typeof options.value !== 'string' ? options.value.credentials : undefined;

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

    const { clientId, clientSecret, refreshToken } = await readGcloudAdc(credentials);
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

export async function readGcloudAdc(env?: Record<string, string>): Promise<GcloudAdcCredentials> {
  const path = resolveGcloudAdcPath(env);
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

function resolveGcloudAdcPath(env?: Record<string, string>): string {
  const envPath = env?.['GOOGLE_APPLICATION_CREDENTIALS'];
  if (envPath) return envPath;

  if (platform() === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData) return join(appData, 'gcloud', 'application_default_credentials.json');
  }

  return join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}
