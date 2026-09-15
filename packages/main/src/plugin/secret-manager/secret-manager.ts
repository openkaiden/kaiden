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

import { isAbsolute } from 'node:path';

import type { Configuration, InferenceProviderConnection } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
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

/**
 * Extract the binary path from an agent command string.
 * For example, `'claude'` returns `'claude'` and
 * `'/usr/bin/agent start'` returns `'/usr/bin/agent'`.
 */
export function extractBinaryFromCommand(command: string): string {
  return command.trim().split(/\s+/)[0] ?? command.trim();
}

/**
 * Check whether an agent binary is allowed by a profile's binaries list.
 *
 * - Absolute agent command: match by exact equality.
 * - Relative agent command: match if any binary ends with `/$command`.
 */
export function isAgentCommandAllowed(agentBinary: string, binaries: string[]): boolean {
  if (isAbsolute(agentBinary)) {
    return binaries.includes(agentBinary);
  }
  return binaries.some(b => b === agentBinary || b.endsWith(`/${agentBinary}`));
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

  async listServices(): Promise<OpenshellProfile[]> {
    return this.cli.listServices();
  }

  async getSecretForModel(modelId: string, gateway?: string): Promise<SecretInfo | undefined> {
    const info = this.providerRegistry.getInferenceConnection(modelId);
    if (!info) return undefined;

    const expectedName = `${info.providerId}-${info.connection.id}`;
    const secrets = await this.list(gateway);
    const secret = secrets.find(s => s.name === expectedName);
    if (!secret) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, sonarjs/no-unused-vars -- gateway is intentionally omitted
    const { gateway: _, ...secretInfo } = secret;
    return secretInfo;
  }

  async ensureSecretForModel(modelId: string, gateway?: string): Promise<SecretInfo | undefined> {
    const existing = await this.getSecretForModel(modelId, gateway);
    if (existing) return existing;

    const info = this.providerRegistry.getInferenceConnection(modelId);
    if (!info) return undefined;

    return this.createSecretForConnection(info.providerId, info.connection, gateway);
  }

  /**
   * Ensure a secret exists for a sandbox. The secret is named
   * `$sandboxName-secret` and is linked to the sandbox rather than
   * the inference connection.
   *
   * When the provider profile restricts binaries, the profile is
   * cloned with the agent command added so the sandbox can run it.
   */
  async ensureSecretForSandbox(
    sandboxName: string,
    modelId: string,
    agentCommand: string,
    gateway?: string,
  ): Promise<SecretInfo | undefined> {
    const secretName = `${sandboxName}-secret`;

    const existingSecrets = await this.list(gateway);
    const existing = existingSecrets.find(s => s.name === secretName);
    if (existing) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, sonarjs/no-unused-vars -- gateway is intentionally omitted
      const { gateway: _, ...secretInfo } = existing;
      return secretInfo;
    }

    const info = this.providerRegistry.getInferenceConnection(modelId);
    if (!info) return undefined;

    return this.createSecretForSandbox(secretName, info.providerId, info.connection, agentCommand, gateway);
  }

  private async createSecretForSandbox(
    secretName: string,
    providerId: string,
    connection: InferenceProviderConnection,
    agentCommand: string,
    gateway?: string,
  ): Promise<SecretInfo | undefined> {
    const provider = this.providerRegistry.getProvider(providerId);
    const { config, connectionProperties } = this.getConnectionProperties(connection, provider);

    const typeEntry = connectionProperties.find(([fullKey]) => fullKey.endsWith('_type'));
    if (!typeEntry) return undefined;

    const secretType = config.get<string>(typeEntry[0]);
    if (!secretType) return undefined;

    const resolvedType = await this.resolveProfileForAgent(secretType, agentCommand, gateway);

    const secretValue = await this.buildSecretValue(config, connectionProperties, provider);

    await this.create(
      {
        name: secretName,
        type: resolvedType,
        value: secretValue,
      },
      gateway,
    );

    return { name: secretName, type: resolvedType };
  }

  /**
   * Check whether the agent command is allowed by the profile's
   * binaries list. If not, clone the profile with the agent command
   * added and return the cloned profile's ID.
   *
   * A missing `binaries` field is treated as an empty list, meaning
   * no binary is authorised and the profile must be cloned.
   */
  async resolveProfileForAgent(profileId: string, agentCommand: string, gateway?: string): Promise<string> {
    const profiles = await this.listServices();
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) {
      return profileId;
    }

    const binaries = profile.binaries ?? [];
    const agentBinary = extractBinaryFromCommand(agentCommand);
    if (isAgentCommandAllowed(agentBinary, binaries)) {
      return profileId;
    }

    const agentName = agentBinary.includes('/') ? agentBinary.split('/').pop()! : agentBinary;
    const clonedProfileName = `${profileId}-${agentName}`;

    const existingClone = profiles.find(p => p.id === clonedProfileName);
    if (existingClone) {
      return clonedProfileName;
    }

    const binaryPattern = isAbsolute(agentBinary) ? agentBinary : `/**/${agentBinary}`;
    await this.openshellAdapter.createProfile(
      { name: clonedProfileName, from: profileId, binaries: [binaryPattern] },
      gateway,
    );

    return clonedProfileName;
  }

  async createSecretForConnection(
    providerId: string,
    connection: InferenceProviderConnection,
    gateway?: string,
  ): Promise<SecretInfo | undefined> {
    const provider = this.providerRegistry.getProvider(providerId);
    const { config, connectionProperties } = this.getConnectionProperties(connection, provider);

    const typeEntry = connectionProperties.find(([fullKey]) => fullKey.endsWith('_type'));
    if (!typeEntry) return undefined;

    const secretType = config.get<string>(typeEntry[0]);
    if (!secretType) return undefined;

    const value = await this.buildSecretValue(config, connectionProperties, provider);

    const secretName = `${providerId}-${connection.id}`;

    await this.create(
      {
        name: secretName,
        type: secretType,
        value: value,
      },
      gateway,
    );

    return { name: secretName, type: secretType };
  }

  private async buildSecretValue(
    config: Configuration,
    connectionProperties: [string, IConfigurationPropertyRecordedSchema][],
    provider: ProviderImpl,
  ): Promise<SecretValue> {
    const flagsEntry = connectionProperties.find(([fullKey]) => fullKey.endsWith('._flags'));
    const flagsRaw = flagsEntry ? config.get<string | string[]>(flagsEntry[0]) : undefined;
    const flagsValue = flagsRaw ? (Array.isArray(flagsRaw) ? flagsRaw : [flagsRaw]) : undefined;

    const configKeys = connectionProperties.filter(
      ([fullKey, _schema]) => !fullKey.endsWith('._type') && !fullKey.endsWith('._flags'),
    );

    const extensionStorage = this.safeStorageRegistry.getExtensionStorage(provider.extensionId);

    const value: SecretValue = { credentials: {} };
    if (flagsValue) {
      value.flags = flagsValue;
    }
    for (const [propertyName, schema] of configKeys) {
      const secretRefName = config.get<string>(propertyName);
      if (!secretRefName) continue;

      const actualValue = schema.format === 'password' ? await extensionStorage.get(secretRefName) : secretRefName;
      if (!actualValue) continue;

      const shortPropertyName = propertyName.split('.').pop()!;
      if (flagsValue === undefined) {
        if (schema.format === 'password') {
          value.credentials[shortPropertyName] = actualValue;
        } else {
          value.config ??= {};
          value.config[shortPropertyName] = actualValue;
        }
      } else {
        if (schema.format === 'password') {
          value.env ??= {};
          value.env[shortPropertyName] = actualValue;
        } else {
          value.config ??= {};
          value.config[shortPropertyName] = actualValue;
        }
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
