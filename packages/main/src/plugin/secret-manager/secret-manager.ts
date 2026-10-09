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
import { isAbsolute } from 'node:path';

import type { Configuration, InferenceProviderConnection } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { OpenshellNetworkPolicy } from '/@/plugin/openshell-cli/openshell-network-policy.js';
import { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import { ProviderImpl } from '/@/plugin/provider-impl.js';
import { ProviderRegistry } from '/@/plugin/provider-registry.js';
import { SafeStorageRegistry } from '/@/plugin/safe-storage/safe-storage-registry.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import { IConfigurationPropertyRecordedSchema, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { OpenshellProfile } from '/@api/openshell-gateway-info.js';
import type {
  GatewaySecretInfo,
  SecretCliBackend,
  SecretCreateOptions,
  SecretInfo,
  SecretName,
  SecretValue,
} from '/@api/secret-info.js';

import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';

export interface SandboxSecretResult {
  secretName: string;
  clonedProfile?: string;
}

/**
 * Manages secrets by delegating to a CLI backend.
 *
 */
@injectable()
export class SecretManager {
  constructor(
    @inject(ApiSenderType)
    private readonly apiSender: ApiSenderType,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(OpenshellSecretAdapter)
    private readonly openshellAdapter: OpenshellSecretAdapter,
    @inject(ProviderRegistry)
    private readonly providerRegistry: ProviderRegistry,
    @inject(IConfigurationRegistry)
    private readonly configurationRegistry: IConfigurationRegistry,
    @inject(SafeStorageRegistry)
    private readonly safeStorageRegistry: SafeStorageRegistry,
    @inject(OpenshellGateway)
    private readonly openshellGateway: OpenshellGateway,
    @inject(OpenshellGatewayStateManager)
    private readonly openshellGatewayStateManager: OpenshellGatewayStateManager,
    @inject(OpenshellNetworkPolicy)
    private readonly openshellNetworkPolicy: OpenshellNetworkPolicy,
    @inject(OpenShellRegistry)
    private readonly openshellRegistry: OpenShellRegistry,
  ) {}

  private get cli(): SecretCliBackend {
    return this.openshellAdapter;
  }

  async create(options: SecretCreateOptions, gateway?: string): Promise<SecretName> {
    const result = await this.cli.createSecret(options, gateway);
    this.apiSender.send('secret-manager-update');
    return result;
  }

  async list(gateway?: string): Promise<GatewaySecretInfo[]> {
    if (gateway) {
      const secrets = await this.cli.listSecrets(gateway);
      return secrets.map(secret => ({ ...secret, gateway }));
    }

    await this.openshellGatewayStateManager.whenReady();
    const results: GatewaySecretInfo[] = [];
    for (const registeredGateway of this.openshellGatewayStateManager.listGateways()) {
      try {
        const secrets = await this.cli.listSecrets(registeredGateway.name);
        results.push(...secrets.map(secret => ({ ...secret, gateway: registeredGateway.name })));
      } catch (err: unknown) {
        console.warn(
          `[openshell] failed to list providers for gateway ${registeredGateway.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return results;
  }

  async remove(name: string, gateway?: string): Promise<SecretName> {
    const result = await this.cli.removeSecret(name, gateway);
    this.apiSender.send('secret-manager-update');
    return result;
  }

  async removeProfile(profileId: string, gateway?: string): Promise<void> {
    await this.openshellAdapter.deleteProfile(profileId, gateway);
  }

  async listServices(gateway?: string): Promise<OpenshellProfile[]> {
    return this.cli.listServices(gateway);
  }

  /**
   * Ensure a secret exists for a sandbox. The secret is named
   * `$sandboxName-$uuid` and is linked to the sandbox rather than
   * the inference connection.
   *
   * The provider profile is always cloned
   * with the agent command added so the sandbox can run it.
   */
  async ensureSecretForSandbox(
    sandboxName: string,
    modelId: string,
    agentCommand: string,
    gateway?: string,
  ): Promise<SandboxSecretResult | undefined> {
    const info = this.providerRegistry.getInferenceConnection(modelId);
    if (!info) return undefined;

    return this.createSecretForSandbox(sandboxName, info.providerId, info.connection, agentCommand, gateway);
  }

  private async createSecretForSandbox(
    sandboxName: string,
    providerId: string,
    connection: InferenceProviderConnection,
    agentCommand: string,
    gateway?: string,
  ): Promise<SandboxSecretResult | undefined> {
    const provider = this.providerRegistry.getProvider(providerId);
    const { config, connectionProperties } = this.getConnectionProperties(connection, provider);

    const typeEntry = connectionProperties.find(([fullKey]) => fullKey.endsWith('_type'));
    if (!typeEntry) return undefined;

    const secretType = config.get<string>(typeEntry[0]);
    if (!secretType) return undefined;

    const uuid = randomUUID();
    const secretName = `${sandboxName}-${uuid}`;

    const clonedProfile = await this.resolveProfileForAgent({
      profileId: secretType,
      agentCommand,
      sandboxName,
      uuid,
      gateway,
      endpoint: connection.endpoint,
    });

    try {
      const resolvedType = clonedProfile ?? secretType;
      const secretValue = await this.buildSecretValue(config, connectionProperties, provider);

      await this.create(
        {
          name: secretName,
          type: resolvedType,
          parentType: secretType,
          value: secretValue,
        },
        gateway,
      );

      return { secretName, clonedProfile };
    } catch (err: unknown) {
      if (clonedProfile) {
        try {
          await this.removeProfile(clonedProfile, gateway);
        } catch (err: unknown) {
          console.error(`Error while deleting profile ${clonedProfile} on gateway ${gateway}`, err);
        }
      }
      throw err;
    }
  }

  /**
   * Clone the provider profile for the sandbox, adding the agent binary
   * if needed. Returns the cloned profile name, or `undefined` when the
   * profile should be used directly (e.g. google-vertex-ai which manages
   * credential refresh via the gateway).
   */
  async resolveProfileForAgent({
    profileId,
    agentCommand,
    sandboxName,
    uuid,
    gateway,
    endpoint,
  }: {
    profileId: string;
    agentCommand: string;
    sandboxName: string;
    uuid: string;
    gateway?: string;
    endpoint?: string;
  }): Promise<string | undefined> {
    const profiles = this.openshellRegistry.getProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) {
      throw new Error(`The required profile ${profileId} does not exist`);
    }

    if (!this.openshellAdapter.shouldCloneProfile(profileId)) {
      await this.openshellAdapter.ensureProfileOnGateway(profileId, gateway);
      return undefined;
    }

    const binaries = profile.binaries?.map(b => b.path) ?? [];
    const agentBinary = this.openshellNetworkPolicy.extractBinaryFromCommand(agentCommand);
    const clonedProfileName = `${sandboxName}-${uuid}`;

    const binaryPattern = isAbsolute(agentBinary) ? agentBinary : `/**/${agentBinary}`;
    if (!this.openshellNetworkPolicy.isAgentCommandAllowed(agentBinary, binaries)) {
      binaries.push(binaryPattern);
    }
    await this.openshellAdapter.createProfile(
      { name: clonedProfileName, from: profileId, binaries: binaries, endpoint },
      gateway,
    );

    return clonedProfileName;
  }

  private async buildSecretValue(
    config: Configuration,
    connectionProperties: [string, IConfigurationPropertyRecordedSchema][],
    provider: ProviderImpl,
  ): Promise<SecretValue> {
    const configKeys = connectionProperties.filter(([fullKey]) => !fullKey.endsWith('._type'));

    const extensionStorage = this.safeStorageRegistry.getExtensionStorage(provider.extensionId);

    const value: SecretValue = { credentials: {} };
    for (const [propertyName, schema] of configKeys) {
      const secretRefName = config.get<string>(propertyName);
      if (!secretRefName) continue;

      const actualValue = schema.format === 'password' ? await extensionStorage.get(secretRefName) : secretRefName;
      if (!actualValue) continue;

      const shortPropertyName = propertyName.split('.').pop()!;
      if (schema.format === 'password') {
        value.credentials[shortPropertyName] = actualValue;
      } else {
        value.config ??= {};
        value.config[shortPropertyName] = actualValue;
      }
    }
    return value;
  }

  public getConnectionProperties(
    connection: InferenceProviderConnection,
    provider: ProviderImpl,
  ): { config: Configuration; connectionProperties: [string, IConfigurationPropertyRecordedSchema][] } {
    const config = this.configurationRegistry.getConfiguration(undefined, connection);
    const allProperties = this.configurationRegistry.getConfigurationProperties();

    const connectionProperties = Object.entries(allProperties)
      .filter(([, schema]) => {
        const scope = schema.scope;
        return Array.isArray(scope)
          ? scope.includes('InferenceProviderConnection')
          : scope === 'InferenceProviderConnection';
      })
      .filter(([_, schema]) => schema.extension?.id === provider.extensionId);
    return { config, connectionProperties };
  }

  init(): void {
    this.openshellGateway.onDidGatewayStart(() => {
      this.apiSender.send('secret-manager-update');
    });

    this.ipcHandle(
      'secret-manager:create',
      async (_listener: unknown, options: SecretCreateOptions): Promise<SecretName> => {
        return this.create(options);
      },
    );

    this.ipcHandle('secret-manager:list', async (_listener: unknown, gateway?: string): Promise<SecretInfo[]> => {
      return this.list(gateway);
    });

    this.ipcHandle(
      'secret-manager:remove',
      async (_listener: unknown, name: string, gateway?: string): Promise<SecretName> => {
        return this.remove(name, gateway);
      },
    );

    this.ipcHandle('secret-manager:list-services', async (): Promise<OpenshellProfile[]> => {
      return this.listServices();
    });
  }
}
