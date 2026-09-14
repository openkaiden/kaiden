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

import type { Configuration, InferenceProviderConnection } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { ProviderImpl } from '/@/plugin/provider-impl.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import { IConfigurationPropertyRecordedSchema, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { OpenshellProfile } from '/@api/openshell-gateway-info.js';
import type {
  GatewaySecretInfo,
  SecretCliBackend,
  SecretCreateOptions,
  SecretInfo,
  SecretName,
} from '/@api/secret-info.js';

import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';

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
    @inject(IConfigurationRegistry)
    private readonly configurationRegistry: IConfigurationRegistry,
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
