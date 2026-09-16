/**********************************************************************
 * Copyright (C) 2025-2026 Red Hat, Inc.
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

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  configuration as ConfigurationAPI,
  Disposable,
  InferenceModel,
  InferenceProviderConnection,
  Provider,
  provider as ProviderAPI,
  ProviderConnectionStatus,
  SecretStorage,
} from '@openkaiden/api';

export const TOKENS_KEY = 'openai:infos';
export const PROVIDER_ID = 'openai';

export interface StoredConnection {
  id: string;
  apiKey: string;
  baseURL: string;
}

export class OpenAI implements Disposable {
  private provider: Provider | undefined = undefined;
  private connections: Map<string, Disposable> = new Map();

  constructor(
    private readonly providerAPI: typeof ProviderAPI,
    private readonly secrets: SecretStorage,
    private readonly configurationAPI: typeof ConfigurationAPI,
  ) {}

  async init(): Promise<void> {
    // create provider
    this.provider = this.providerAPI.createProvider({
      name: 'OpenAI',
      status: 'unknown',
      id: 'openai',
    });

    // register MCP Provider connection factory
    this.provider?.setInferenceProviderConnectionFactory({
      connectionTypes: ['cloud'],
      llmMetadata: { name: 'openai' },
      create: this.inferenceFactory.bind(this),
    });

    // restore persistent connections
    await this.restoreConnections();
  }

  private async restoreConnections(): Promise<void> {
    const stored = await this.getStoredConnections();
    for (const entry of stored) {
      try {
        await this.registerInferenceProviderConnection({
          id: entry.id,
          token: entry.apiKey,
          baseURL: entry.baseURL,
        });
      } catch (err: unknown) {
        console.error(`openai: failed to restore connection for baseURL ${entry.baseURL}`, err);
      }
    }
  }

  private async getStoredConnections(): Promise<StoredConnection[]> {
    let raw: string | undefined;
    try {
      raw = await this.secrets.get(TOKENS_KEY);
    } catch (err: unknown) {
      console.error('openai: something went wrong while trying to get tokens from secret storage', err);
    }
    if (!raw) return [];

    try {
      return JSON.parse(raw) as StoredConnection[];
    } catch {
      // Migrate legacy pipe+comma-separated format (apiKey|baseURL,apiKey|baseURL)
      const entries = raw.split(',');
      const migrated: StoredConnection[] = entries.map(str => {
        const [apiKey, baseURL] = str.split('|');
        return { id: randomUUID(), apiKey, baseURL };
      });
      await this.secrets.store(TOKENS_KEY, JSON.stringify(migrated));
      return migrated;
    }
  }

  private async saveConnection(connection: StoredConnection): Promise<void> {
    const stored = await this.getStoredConnections();
    stored.push(connection);
    await this.secrets.store(TOKENS_KEY, JSON.stringify(stored));
  }

  private async removeConnection(id: string): Promise<void> {
    const stored = await this.getStoredConnections();
    const filtered = stored.filter(entry => entry.id !== id);
    await this.secrets.store(TOKENS_KEY, JSON.stringify(filtered));
  }

  protected async listModels(baseURL: string, token: string): Promise<Array<{ label: string }>> {
    const res = await fetch(`${baseURL}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status !== 200) throw new Error('failed to list models');
    const body = await res.json();

    if (!('data' in body)) throw new Error(`malformed response from ${baseURL}`);
    if (!Array.isArray(body.data)) throw new Error(`malformed response from ${baseURL}: data is not an array`);

    return body.data.map((model: { id: string }) => ({ label: model.id }));
  }

  private getSecretName(connectionId: string): string {
    return `${PROVIDER_ID}:${connectionId}:token`;
  }

  private async setConnectionConfiguration(connection: InferenceProviderConnection, token: string): Promise<void> {
    const secretName = this.getSecretName(connection.id);
    await this.secrets.store(secretName, token);

    const config = this.configurationAPI.getConfiguration(undefined, connection);
    await config.update('openai.connection._type', PROVIDER_ID);
    await config.update('openai.connection.OPENAI_API_KEY', secretName);
  }

  private async clearConnectionConfiguration(connection: InferenceProviderConnection): Promise<void> {
    const secretName = this.getSecretName(connection.id);
    await this.secrets.delete(secretName);

    const config = this.configurationAPI.getConfiguration(undefined, connection);
    await config.update('openai.connection._type', undefined);
    await config.update('openai.connection.OPENAI_API_KEY', undefined);
  }

  private async registerInferenceProviderConnection({
    id,
    token,
    baseURL,
  }: {
    id: string;
    token: string;
    baseURL: string;
  }): Promise<void> {
    if (!this.provider) throw new Error('cannot create MCP provider connection: provider is not initialized');

    let models: InferenceModel[] = [];
    let status: ProviderConnectionStatus = 'unknown';

    try {
      models = await this.listModels(baseURL, token);
    } catch (err: unknown) {
      console.warn(`openai: failed to list models for ${baseURL}`, err);
      status = 'stopped';
    }

    const openai = createOpenAICompatible({
      baseURL: baseURL,
      apiKey: token,
      name: baseURL,
    });

    const connection: InferenceProviderConnection = {
      id,
      name: baseURL,
      type: 'cloud',
      llmMetadata: { name: 'openai' },
      endpoint: baseURL,
      sdk: openai,
      status(): ProviderConnectionStatus {
        return status;
      },
      lifecycle: {
        delete: async (): Promise<void> => {
          await this.clearConnectionConfiguration(connection);
          this.connections.get(id)?.dispose();
          this.connections.delete(id);
          await this.removeConnection(id);
        },
      },
      models,
      credentials(): Record<string, string> {
        return {
          'openai:tokens': token,
        };
      },
    };

    await this.setConnectionConfiguration(connection, token);

    try {
      const connectionDisposable = this.provider.registerInferenceProviderConnection(connection);
      this.connections.set(id, connectionDisposable);
    } catch (err: unknown) {
      await this.clearConnectionConfiguration(connection);
      throw err;
    }
  }

  private async inferenceFactory(params: { [p: string]: unknown }): Promise<void> {
    const apiKey = params['openai.factory.apiKey'];
    if (!apiKey || typeof apiKey !== 'string') throw new Error('invalid apiKey');

    const baseURL = params['openai.factory.baseURL'];
    if (!baseURL || typeof baseURL !== 'string') throw new Error('invalid baseURL');

    const stored = await this.getStoredConnections();
    if (stored.some(c => c.apiKey === apiKey && c.baseURL === baseURL)) {
      throw new Error(`connection already exists for baseURL ${baseURL}`);
    }

    const id = randomUUID();
    await this.saveConnection({ id, apiKey, baseURL });
    await this.registerInferenceProviderConnection({ id, token: apiKey, baseURL });
  }

  dispose(): void {
    this.provider?.dispose();
    this.connections.forEach(disposable => disposable.dispose());
    this.connections.clear();
  }
}
