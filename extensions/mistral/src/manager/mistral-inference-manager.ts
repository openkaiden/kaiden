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

import { createHash } from 'node:crypto';

import { createMistral } from '@ai-sdk/mistral';
import { Mistral } from '@mistralai/mistralai';
import type { Disposable, InferenceModel, Provider, ProviderConnectionStatus, SecretStorage } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { MistralProviderSymbol, SecretStorageSymbol } from '/@/inject/symbol';

export const TOKENS_KEY = 'mistral:tokens';
export const TOKEN_SEPARATOR = ',';

@injectable()
export class MistralInferenceManager {
  @inject(MistralProviderSymbol)
  private mistralProvider: Provider;

  @inject(SecretStorageSymbol)
  private secrets: SecretStorage;

  private connections: Map<string, Disposable> = new Map();

  async init(): Promise<void> {
    this.mistralProvider.setInferenceProviderConnectionFactory({ create: this.factory.bind(this) });
    await this.restoreConnections();
  }

  private async restoreConnections(): Promise<void> {
    const tokens = await this.getTokens();
    for (const token of tokens) {
      await this.registerInferenceProviderConnection({ token });
    }
  }

  private async getTokens(): Promise<string[]> {
    let raw: string | undefined;
    try {
      raw = await this.secrets.get(TOKENS_KEY);
    } catch (err: unknown) {
      console.error('Mistral: something went wrong while trying to get tokens from secret storage', err);
    }
    if (!raw) return [];
    return raw.split(TOKEN_SEPARATOR);
  }

  private async saveToken(token: string): Promise<void> {
    const tokens: Array<string> = await this.getTokens();
    const raw = [...tokens, token].join(TOKEN_SEPARATOR);
    await this.secrets.store(TOKENS_KEY, raw);
  }

  private getTokenHash(token: string): string {
    const sha256 = createHash('sha256');
    return sha256.update(token).digest('hex');
  }

  private async removeToken(token: string): Promise<void> {
    const tokens: Array<string> = await this.getTokens();
    const raw = tokens.filter(t => t !== token).join(TOKEN_SEPARATOR);
    await this.secrets.store(TOKENS_KEY, raw);
  }

  private async registerInferenceProviderConnection({ token }: { token: string }): Promise<void> {
    const key = this.maskKey(token);
    const tokenHash = this.getTokenHash(token);

    if (this.connections.has(tokenHash)) {
      throw new Error(`connection already exists for token ${key}`);
    }

    const mistral = createMistral({
      apiKey: token,
    });

    const clean = async (): Promise<void> => {
      this.connections.get(tokenHash)?.dispose();
      this.connections.delete(tokenHash);
      await this.removeToken(token);
    };

    let status: ProviderConnectionStatus = 'unknown';
    let models: InferenceModel[] = [];

    try {
      models = await this.getMistralModels(token);
    } catch (err: unknown) {
      status = 'stopped';
    }

    const connectionDisposable = this.mistralProvider.registerInferenceProviderConnection({
      name: this.maskKey(token),
      type: 'cloud',
      llmMetadata: { name: 'mistral' },
      sdk: mistral,
      status(): ProviderConnectionStatus {
        return status;
      },
      lifecycle: {
        delete: clean.bind(this),
      },
      models,
      credentials(): Record<string, string> {
        return {
          [TOKENS_KEY]: token,
        };
      },
    });
    this.connections.set(tokenHash, connectionDisposable);
  }

  private async getMistralModels(token: string): Promise<Array<{ label: string }>> {
    const client = new Mistral({ apiKey: token });
    const response = await client.models.list();
    const models: InferenceModel[] = [];
    for (const model of response.data ?? []) {
      if (model.type !== 'UNKNOWN' && model.id && model.capabilities.completionChat) {
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
    const apiKey = params['mistral.factory.apiKey'];
    if (!apiKey || typeof apiKey !== 'string') throw new Error('invalid apiKey');

    await this.saveToken(apiKey);
    await this.registerInferenceProviderConnection({ token: apiKey });
  }

  dispose(): void {
    this.connections.forEach(disposable => disposable.dispose());
    this.connections.clear();
  }
}
