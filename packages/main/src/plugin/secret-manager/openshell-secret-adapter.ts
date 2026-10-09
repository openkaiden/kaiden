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
import {
  ImportProviderProfilesRequestSchema,
  NetworkAccessPreset,
  NetworkBinarySchema,
  NetworkEndpointSchema,
  ProviderProfileSchema,
} from '@nvidia/openshell-sdk/raw';
import { inject, injectable, multiInject } from 'inversify';

import { OpenshellNetworkPolicy } from '/@/plugin/openshell-cli/openshell-network-policy.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { DEFAULT_WORKSPACE_SCOPE } from '/@/plugin/openshell-cli/openshell-utils.js';
import { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import { DefaultProviderFactory } from '/@/plugin/secret-manager/default-provider-factory.js';
import { type CreateProfileOptions, type OpenshellProfile } from '/@api/openshell-gateway-info.js';
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
    @inject(OpenshellNetworkPolicy)
    private readonly openshellNetworkPolicy: OpenshellNetworkPolicy,
    @inject(OpenShellRegistry)
    private readonly openshellRegistry: OpenShellRegistry,
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
    const response = await client.raw.listProviders({
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
    return response.providers.map(p => ({
      name: p.metadata?.name ?? '',
      type: p.type,
    }));
  }

  async removeSecret(name: string, gateway?: string): Promise<SecretName> {
    const client = await this.sdkClientManager.getClient(gateway);
    await client.raw.deleteProvider({
      name,
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
    return { name };
  }

  async listServices(gateway?: string): Promise<OpenshellProfile[]> {
    const client = await this.sdkClientManager.getClient(gateway);
    const response = await client.raw.listProviderProfiles({
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
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
      binaries: p.binaries?.length ? p.binaries.map(b => b.path) : undefined,
    }));
  }

  async createProfile(options: CreateProfileOptions, gateway?: string): Promise<void> {
    const baseProfile = this.openshellRegistry.getProfiles().find(p => p.id === options.from);
    if (!baseProfile) {
      throw new Error(`Provider profile "${options.from}" not found`);
    }
    const cloned = create(ProviderProfileSchema, {
      ...baseProfile,
      id: options.name,
      binaries: options.binaries.map(b =>
        create(NetworkBinarySchema, {
          path: b,
        }),
      ),
    });
    if (options.endpoint) {
      const parsed = this.openshellNetworkPolicy.parseModelEndpoint(options.endpoint);
      if (parsed) {
        if (!this.openshellNetworkPolicy.isEndpointCovered(baseProfile.endpoints ?? [], parsed)) {
          const endpointEntry = create(NetworkEndpointSchema, {
            host: parsed.host,
            port: parsed.port,
            protocol: 'rest',
            access: NetworkAccessPreset.FULL,
            allowEncodedSlash: true,
          });
          cloned.endpoints = [...(baseProfile.endpoints ?? []), endpointEntry];
        }
      }
    }
    const client = await this.sdkClientManager.getClient(gateway);
    const result = await client.raw.importProviderProfiles(
      create(ImportProviderProfilesRequestSchema, {
        profiles: [
          {
            profile: cloned,
            source: `cloned from ${options.from}`,
          },
        ],
        workspaceScope: DEFAULT_WORKSPACE_SCOPE,
      }),
    );
    if (!result.imported) {
      throw new Error(
        `Provider profile ${cloned.id} can't be imported, diagnostics: ${JSON.stringify(result.diagnostics)}`,
      );
    }
  }

  async deleteProfile(profileId: string, gateway?: string): Promise<void> {
    const client = await this.sdkClientManager.getClient(gateway);
    await client.raw.deleteProviderProfile({
      id: profileId,
      allowMissing: true,
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
  }

  async ensureProfileOnGateway(profileId: string, gateway?: string): Promise<void> {
    const client = await this.sdkClientManager.getClient(gateway);
    const response = await client.raw.listProviderProfiles({
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
    if (response.profiles.some(p => p.id === profileId)) {
      return;
    }
    const profile = this.openshellRegistry.getProfiles().find(p => p.id === profileId);
    if (!profile) {
      throw new Error(`Provider profile "${profileId}" not found in registry`);
    }
    const result = await client.raw.importProviderProfiles({
      profiles: [
        {
          profile: profile,
          source: 'imported from registry',
        },
      ],
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
    if (!result.imported) {
      throw new Error(
        `Provider profile ${profileId} can't be imported, diagnostics: ${JSON.stringify(result.diagnostics)}`,
      );
    }
  }

  shouldCloneProfile(profileId: string): boolean {
    const factory = this.providerFactories.find(f => f.supports(profileId));
    return factory?.requiresClone ?? true;
  }

  #resolveFactory(options: SecretCreateOptions): ProviderFactory {
    return (
      this.providerFactories.find(f => f.supports(options.parentType ?? options.type)) ?? this.defaultProviderFactory
    );
  }
}
