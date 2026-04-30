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
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { CoreV1Api, CustomObjectsApi, KubeConfig } from '@kubernetes/client-node';
import type {
  Disposable,
  InferenceModel,
  Provider,
  provider as ProviderAPI,
  ProviderConnectionStatus,
  SecretStorage,
} from '@openkaiden/api';

export const TOKENS_KEY = 'openshiftai:infos';
export const TOKEN_SEPARATOR = ',';
const INFO_SEPARATOR = '|';

interface ConnectionInfo {
  token: string;
  baseURL: string;
}

export class OpenShiftAI implements Disposable {
  private provider: Provider | undefined = undefined;
  private connections: Map<ConnectionInfo, Disposable> = new Map();

  constructor(
    private readonly providerAPI: typeof ProviderAPI,
    private readonly secrets: SecretStorage,
  ) {}

  async init(): Promise<void> {
    // create provider
    this.provider = this.providerAPI.createProvider({
      name: 'OpenShift AI',
      status: 'unknown',
      id: 'openshiftai',
      emptyConnectionMarkdownDescription:
        'Provides OpenShift AI integration. Connects Kaiden to models running on OpenShift AI.',
      images: {
        icon: './icon.png',
        logo: {
          dark: './icon.png',
          light: './icon.png',
        },
      },
    });

    // register inference Provider connection factory
    this.provider.setInferenceProviderConnectionFactory({ create: this.inferenceFactory.bind(this) });

    // restore persistent connections
    await this.restoreConnections();
  }

  private async restoreConnections(): Promise<void> {
    const connectionInfos = await this.getConnectionInfos();
    for (const connectionInfo of connectionInfos) {
      try {
        await this.registerInferenceProviderConnection({
          token: connectionInfo.token,
          baseURL: connectionInfo.baseURL,
        });
      } catch (err: unknown) {
        console.error(`OpenShift AI: failed to restore connection for baseURL ${connectionInfo.baseURL}`, err);
      }
    }
  }

  private async getTokens(): Promise<string[]> {
    // get raw string from secret storage
    let raw: string | undefined;
    try {
      raw = await this.secrets.get(TOKENS_KEY);
    } catch (err: unknown) {
      console.error('OpenShift AI: something went wrong while trying to get tokens from secret storage', err);
    }
    // if undefined return empty array
    if (!raw) return [];
    // split raw string by token separator
    return raw.split(TOKEN_SEPARATOR);
  }

  /**
   * Get all connection infos from secret storage
   * @private
   */
  private async getConnectionInfos(): Promise<ConnectionInfo[]> {
    return (await this.getTokens()).map(str => {
      const [token, baseURL] = str.split(INFO_SEPARATOR);
      return {
        token,
        baseURL,
      };
    });
  }

  /**
   * Save connection info to secret storage
   * @param token
   * @param baseURL
   * @private
   */
  private async saveConnectionInfo(token: string, baseURL: string): Promise<void> {
    // get existing tokens
    const tokens = await this.getTokens();
    // concat new token with existing tokens
    const raw = [...tokens, `${token}${INFO_SEPARATOR}${baseURL}`].join(TOKEN_SEPARATOR);
    // save to secret storage
    await this.secrets.store(TOKENS_KEY, raw);
  }

  private async removeConnectionInfo(token: string, baseURL: string): Promise<void> {
    // get existing tokens
    const tokens = await this.getConnectionInfos();
    // filter out the token
    const raw = tokens.filter(t => t.token !== token || t.baseURL !== baseURL).join(TOKEN_SEPARATOR);
    // save to secret storage
    await this.secrets.store(TOKENS_KEY, raw);
  }

  protected async listModels({ baseURL, token }: ConnectionInfo): Promise<Array<InferenceModel>> {
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

  private async getToken(coreAPI: CoreV1Api, namespace: string, runtime: string): Promise<string> {
    const secrets = await coreAPI.listNamespacedSecret({ namespace });
    for (const secret of secrets.items) {
      if (secret.metadata?.annotations?.['kubernetes.io/service-account.name'] === runtime) {
        if (secret.data?.['token']) {
          return Buffer.from(secret.data['token'], 'base64').toString('utf-8');
        }
      }
    }
    throw new Error(`Failed to find token for runtime ${runtime}`);
  }

  private async getInferenceServices(url: string, token: string): Promise<ConnectionInfo[]> {
    const urls: ConnectionInfo[] = [];
    try {
      const user = {
        name: token,
        token,
      };
      const cluster = {
        name: 'openshift-ai',
        server: url,
        skipTLSVerify: true,
      };
      const context = {
        cluster: cluster.name,
        user: user.name,
        name: 'openshift-ai',
      };
      const kc = new KubeConfig();
      kc.loadFromOptions({
        clusters: [cluster],
        users: [user],
        contexts: [context],
        currentContext: context.name,
      });
      const coreAPI = kc.makeApiClient(CoreV1Api);
      const genericAPI = kc.makeApiClient(CustomObjectsApi);
      const projects = await genericAPI.listClusterCustomObject({
        group: 'project.openshift.io',
        version: 'v1',
        plural: 'projects',
      });
      for (const project of projects.items) {
        if (project.metadata?.name) {
          const inferenceServices = await genericAPI.listNamespacedCustomObject({
            group: 'serving.kserve.io',
            version: 'v1beta1',
            namespace: project.metadata.name,
            plural: 'inferenceservices',
          });
          for (const inferenceService of inferenceServices.items) {
            try {
              const token = await this.getToken(
                coreAPI,
                project.metadata.name,
                `${inferenceService.spec?.predictor?.model?.runtime}-sa`,
              );
              if (token && inferenceService.status.url) {
                urls.push({
                  token,
                  baseURL: `${inferenceService.status.url}/v1`,
                });
              }
            } catch (e) {
              console.error(`Error processing inference service ${inferenceService.metadata.name}`, e);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error getting inference services:', e);
    }
    return urls;
  }

  private async registerInferenceProviderConnection({ token, baseURL }: ConnectionInfo): Promise<void> {
    if (!this.provider) throw new Error('cannot create MCP provider connection: provider is not initialized');

    const connectionInfos = await this.getInferenceServices(baseURL, token);

    if (connectionInfos.length === 0) {
      throw new Error('no inference services found on the cluster');
    }

    for (const connectionInfo of connectionInfos) {
      // get hash of the token (used for Map)
      if (this.connections.has(connectionInfo)) {
        throw new Error(`connection already exists for token (hidden) baseURL ${baseURL}`);
      }

      const models = await this.listModels(connectionInfo);

      // create ProviderV2
      const openai = createOpenAICompatible({
        baseURL: connectionInfo.baseURL,
        apiKey: connectionInfo.token,
        name: connectionInfo.baseURL,
      });

      // create a clean method
      const clean = async (): Promise<void> => {
        // dispose inference provider connection
        this.connections.get(connectionInfo)?.dispose();
        // delete map entry
        this.connections.delete(connectionInfo);
        // remove token from secret storage
        await this.removeConnectionInfo(token, baseURL);
      };

      const connectionDisposable = this.provider.registerInferenceProviderConnection({
        name: baseURL,
        type: 'self-hosted',
        endpoint: connectionInfo.baseURL,
        sdk: openai,
        status(): ProviderConnectionStatus {
          return 'unknown'; // if status is not unknown we cannot delete the connection
        },
        lifecycle: {
          delete: clean.bind(this),
        },
        models: models,
        credentials(): Record<string, string> {
          return {
            'openshiftai:tokens': token,
          };
        },
      });
      this.connections.set(connectionInfo, connectionDisposable);
    }
  }

  private async inferenceFactory(params: { [p: string]: unknown }): Promise<void> {
    // extract token from params
    const url = params['openshiftai.factory.url'];
    if (!url || typeof url !== 'string') throw new Error('invalid OpenShift AI URL');

    const token = params['openshiftai.factory.token'];
    if (!token || typeof token !== 'string') throw new Error('invalid token');

    // use dedicated method to register connection
    await this.registerInferenceProviderConnection({
      token,
      baseURL: url,
    });

    await this.saveConnectionInfo(token, url);
  }

  dispose(): void {
    this.provider?.dispose();
    this.connections.forEach(disposable => disposable.dispose());
    this.connections.clear();
  }
}
