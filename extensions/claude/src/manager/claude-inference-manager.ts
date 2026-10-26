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

import { createAnthropic } from '@ai-sdk/anthropic';
import AnthropicClient from '@anthropic-ai/sdk';
import type {
  Disposable,
  InferenceModel,
  InferenceProviderConnection,
  Provider,
  ProviderConnectionStatus,
  SecretStorage,
} from '@openkaiden/api';
import { configuration } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { PROVIDER_ID } from '/@/claude-extension';
import { ClaudeProviderSymbol, SecretStorageSymbol } from '/@/inject/symbol';

export const OPENSHELL_PROFILE_ID = 'anthropic';

export const TOKENS_KEY = 'claude:tokens';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export interface StoredConnection {
  id: string;
  token: string;
  baseURL?: string;
}

@injectable()
export class ClaudeInferenceManager {
  @inject(ClaudeProviderSymbol)
  private claudeProvider: Provider;

  @inject(SecretStorageSymbol)
  private secrets: SecretStorage;

  private connections: Map<string, Disposable> = new Map();

  async init(): Promise<void> {
    this.claudeProvider.setInferenceProviderConnectionFactory({
      connectionTypes: ['cloud'],
      llmMetadata: { name: 'anthropic' },
      create: this.factory.bind(this),
    });
    await this.restoreConnections();
  }

  private async restoreConnections(): Promise<void> {
    const stored = await this.getStoredConnections();
    for (const entry of stored) {
      await this.registerInferenceProviderConnection({
        id: entry.id,
        token: entry.token,
        baseURL: entry.baseURL ?? DEFAULT_BASE_URL,
      });
    }
  }

  private async getStoredConnections(): Promise<StoredConnection[]> {
    let raw: string | undefined;
    try {
      raw = await this.secrets.get(TOKENS_KEY);
    } catch (err: unknown) {
      console.error('Claude: something went wrong while trying to get tokens from secret storage', err);
    }
    if (!raw) return [];

    try {
      return JSON.parse(raw) as StoredConnection[];
    } catch {
      // Migrate legacy comma-separated token format
      const tokens = raw.split(',');
      const migrated: StoredConnection[] = tokens.map(token => ({ id: randomUUID(), token }));
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

  private getSecretName(connectionId: string): string {
    return `${PROVIDER_ID}:${connectionId}:token`;
  }

  private async setConnectionConfiguration(connection: InferenceProviderConnection, token: string): Promise<void> {
    const secretName = this.getSecretName(connection.id);
    await this.secrets.store(secretName, token);

    const config = configuration.getConfiguration(undefined, connection);
    await config.update('claude.connection._type', OPENSHELL_PROFILE_ID);
    await config.update('claude.connection.ANTHROPIC_API_KEY', secretName);
  }

  private async clearConnectionConfiguration(connection: InferenceProviderConnection): Promise<void> {
    const secretName = this.getSecretName(connection.id);
    await this.secrets.delete(secretName);

    const config = configuration.getConfiguration(undefined, connection);
    await config.update('claude.connection._type', undefined);
    await config.update('claude.connection.ANTHROPIC_API_KEY', undefined);
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
    if (this.connections.has(id)) {
      throw new Error(`connection already exists for id ${id}`);
    }

    const isCustomBaseURL = baseURL !== DEFAULT_BASE_URL;

    const anthropic = createAnthropic({
      apiKey: token,
      ...(isCustomBaseURL && { baseURL }),
    });

    let status: ProviderConnectionStatus = 'unknown';
    let models: InferenceModel[] = [];

    try {
      models = await this.getAnthropicModels(token, baseURL);
    } catch (err: unknown) {
      status = 'stopped';
    }

    const connectionName = isCustomBaseURL ? baseURL : this.maskKey(token);

    const connection: InferenceProviderConnection = {
      id,
      name: connectionName,
      type: isCustomBaseURL ? 'self-hosted' : 'cloud',
      llmMetadata: {
        name: 'anthropic',
      },
      ...(isCustomBaseURL && { endpoint: baseURL }),
      sdk: anthropic,
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
          [TOKENS_KEY]: token,
        };
      },
    };

    await this.setConnectionConfiguration(connection, token);

    try {
      const connectionDisposable = this.claudeProvider.registerInferenceProviderConnection(connection);
      this.connections.set(id, connectionDisposable);
    } catch (err: unknown) {
      await this.clearConnectionConfiguration(connection);
      throw err;
    }
  }

  private async getAnthropicModels(token: string, baseURL: string): Promise<Array<{ label: string }>> {
    const isCustomBaseURL = baseURL !== DEFAULT_BASE_URL;
    const client = new AnthropicClient({
      apiKey: token,
      ...(isCustomBaseURL && { baseURL }),
    });
    const models: InferenceModel[] = [];
    for await (const model of client.models.list()) {
      if (model.id) {
        models.push({ label: model.id });
      }
    }
    return models;
  }

  private maskKey(name: string): string {
    if (!name || name.length <= 3) return name;
    return name.slice(0, 3) + '*'.repeat(name.length - 3);
  }

  private async factory(params: { [p: string]: unknown }): Promise<void> {
    const apiKey = params['claude.factory.apiKey'];
    if (!apiKey || typeof apiKey !== 'string') throw new Error('invalid apiKey');

    const rawBaseURL = params['claude.factory.baseURL'];
    const baseURL = typeof rawBaseURL === 'string' && rawBaseURL.trim() ? rawBaseURL.trim() : DEFAULT_BASE_URL;

    const id = randomUUID();
    const isCustomBaseURL = baseURL !== DEFAULT_BASE_URL;
    await this.saveConnection({ id, token: apiKey, ...(isCustomBaseURL && { baseURL }) });
    await this.registerInferenceProviderConnection({ id, token: apiKey, baseURL });
  }

  dispose(): void {
    this.connections.forEach(disposable => disposable.dispose());
    this.connections.clear();
  }
}
