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

import { inject, injectable, multiInject } from 'inversify';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { DefaultProviderFactory } from '/@/plugin/secret-manager/default-provider-factory.js';
import type { OpenshellProfile } from '/@api/openshell-gateway-info.js';
import type { SecretCliBackend, SecretCreateOptions, SecretInfo, SecretName } from '/@api/secret-info.js';

import type { ProviderFactory, SelectableProviderFactory } from './provider-factory.js';
import { SelectableProviderFactoryToken } from './provider-factory.js';

@injectable()
export class OpenshellSecretAdapter implements SecretCliBackend {
  constructor(
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
    @multiInject(SelectableProviderFactoryToken)
    private readonly providerFactories: SelectableProviderFactory[],

    @inject(DefaultProviderFactory)
    private readonly defaultProviderFactory: DefaultProviderFactory,
  ) {}

  async createSecret(options: SecretCreateOptions, gateway?: string): Promise<SecretName> {
    if (typeof options.value === 'string') {
      throw new Error('options.value must be a record for Openshell');
    }
    const client = await this.sdkClientManager.getClient(gateway);
    const factory = this.#resolveFactory(options);
    await factory.createProvider(client, options);
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

  #resolveFactory(options: SecretCreateOptions): ProviderFactory {
    return this.providerFactories.find(f => f.supports(options.type)) ?? this.defaultProviderFactory;
  }
}
