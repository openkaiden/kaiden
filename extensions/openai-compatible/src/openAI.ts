/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  Disposable,
  InferenceModel,
  Provider,
  provider as ProviderAPI,
  ProviderConnectionStatus,
  SecretStorage,
} from '@openkaiden/api';

export const TOKENS_KEY = 'openai:infos';
export const TOKEN_SEPARATOR = ',';
const INFO_SEPARATOR = '|';

interface ConnectionInfo {
  apiKey: string;
  baseURL: string;
}

export class OpenAI implements Disposable {
  private provider: Provider | undefined = undefined;
  private connections: Map<string, Disposable> = new Map();

  constructor(
    private readonly providerAPI: typeof ProviderAPI,
    private readonly secrets: SecretStorage,
  ) {}

  async init(): Promise<void> {
    // create provider
    this.provider = this.providerAPI.createProvider({
      name: 'OpenAI',
      status: 'unknown',
      id: 'openai',
    });

    // register MCP Provider connection factory
    this.provider?.setInferenceProviderConnectionFactory({ create: this.inferenceFactory.bind(this) });

    // restore persistent connections
    await this.restoreConnections();
  }

  private async restoreConnections(): Promise<void> {
    const connectionInfos = await this.getConnectionInfos();
    for (const connectionInfo of connectionInfos) {
      try {
        await this.registerInferenceProviderConnection({
          token: connectionInfo.apiKey,
          baseURL: connectionInfo.baseURL,
        });
      } catch (err: unknown) {
        console.error(`openai: failed to restore connection for baseURL ${connectionInfo.baseURL}`, err);
      }
    }
  }

  /**
   * Get all connection infos from secret storage
   * @private
   */
  private async getConnectionInfos(): Promise<ConnectionInfo[]> {
    // get raw string from secret storage
    let raw: string | undefined;
    try {
      raw = await this.secrets.get(TOKENS_KEY);
    } catch (err: unknown) {
      console.error('openai: something went wrong while trying to get tokens from secret storage', err);
    }
    // if undefined return empty array
    if (!raw) return [];
    // split raw string by token separator
    return raw.split(TOKEN_SEPARATOR).map(str => {
      const [apiKey, baseURL] = str.split(INFO_SEPARATOR);
      return {
        apiKey,
        baseURL,
      };
    });
  }

  /**
   * Save connection info to secret storage
   * @param apiKey
   * @param baseURL
   * @private
   */
  private async saveConnectionInfo(apiKey: string, baseURL: string): Promise<void> {
    // get existing tokens
    const tokens = (await this.getConnectionInfos()).map(t => `${t.apiKey}|${t.baseURL}`);
    // concat new token with existing tokens
    const raw = [...tokens, `${apiKey}${INFO_SEPARATOR}${baseURL}`].join(TOKEN_SEPARATOR);
    // save to secret storage
    await this.secrets.store(TOKENS_KEY, raw);
  }

  private getTokenHash(token: string): string {
    const sha256 = createHash('sha256');
    return sha256.update(token).digest('hex');
  }

  private async removeConnectionInfo(token: string, baseURL: string): Promise<void> {
    // get existing tokens
    const tokens = await this.getConnectionInfos();
    // filter out the token
    const raw = tokens.filter(t => t.apiKey !== token || t.baseURL !== baseURL).join(TOKEN_SEPARATOR);
    // save to secret storage
    await this.secrets.store(TOKENS_KEY, raw);
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

  private async registerInferenceProviderConnection({
    token,
    baseURL,
  }: {
    token: string;
    baseURL: string;
  }): Promise<void> {
    if (!this.provider) throw new Error('cannot create MCP provider connection: provider is not initialized');

    // get hash of the token (used for Map)
    const tokenHash = this.getTokenHash(token);

    if (this.connections.has(tokenHash)) {
      throw new Error(`connection already exists for token (hidden) baseURL ${baseURL}`);
    }

    let models: InferenceModel[] = [];
    let status: ProviderConnectionStatus = 'unknown';

    try {
      models = await this.listModels(baseURL, token);
    } catch (err: unknown) {
      status = 'stopped';
    }

    // create ProviderV2
    const openai = createOpenAICompatible({
      baseURL: baseURL,
      apiKey: token,
      name: baseURL,
    });

    // create a clean method
    const clean = async (): Promise<void> => {
      // dispose inference provider connection
      this.connections.get(tokenHash)?.dispose();
      // delete map entry
      this.connections.delete(tokenHash);
      // remove token from secret storage
      await this.removeConnectionInfo(token, baseURL);
    };

    const connectionDisposable = this.provider.registerInferenceProviderConnection({
      name: baseURL,
      type: 'cloud',
      providerName: 'openai',
      endpoint: baseURL,
      sdk: openai,
      status(): ProviderConnectionStatus {
        return status;
      },
      lifecycle: {
        delete: clean.bind(this),
      },
      models: models,
      credentials(): Record<string, string> {
        return {
          'openai:tokens': token,
        };
      },
    });
    this.connections.set(tokenHash, connectionDisposable);
  }

  private async inferenceFactory(params: { [p: string]: unknown }): Promise<void> {
    // extract key from params
    const apiKey = params['openai.factory.apiKey'];
    if (!apiKey || typeof apiKey !== 'string') throw new Error('invalid apiKey');

    const baseURL = params['openai.factory.baseURL'];
    if (!baseURL || typeof baseURL !== 'string') throw new Error('invalid baseURL');

    // save the connection info in secret storage
    await this.saveConnectionInfo(apiKey, baseURL);

    // use dedicated method to register connection
    await this.registerInferenceProviderConnection({
      token: apiKey,
      baseURL: baseURL,
    });
  }

  dispose(): void {
    this.provider?.dispose();
    this.connections.forEach(disposable => disposable.dispose());
    this.connections.clear();
  }
}
