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
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
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

export const CONNECTIONS_KEY = 'vertex-ai:connections';
export const PROVIDER_ID = 'vertex-ai';
export const OPENSHELL_PROVIDER_ID = 'google-vertex-ai';
const FETCH_TIMEOUT_MS = 30_000;
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export interface VertexAiConnectionConfig {
  projectId: string;
  region: string;
  credentialsFile: string;
}

export interface StoredConnection extends VertexAiConnectionConfig {
  id: string;
}

interface AdcCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  type: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface VertexPublisherModel {
  name: string;
  displayName?: string;
}

interface VertexModelsResponse {
  publisherModels?: VertexPublisherModel[];
}

interface GoogleCloudError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class VertexAiApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'VertexAiApiError';
  }
}

export const FALLBACK_MODELS: InferenceModel[] = [
  { label: 'claude-opus-4-7' },
  { label: 'claude-sonnet-4-6' },
  { label: 'claude-opus-4-6' },
  { label: 'claude-opus-4-5' },
  { label: 'claude-sonnet-4-5' },
  { label: 'claude-haiku-4-5' },
  { label: 'claude-opus-4-1' },
];

export class VertexAi implements Disposable {
  private provider: Provider | undefined;
  private connections: Map<string, Disposable> = new Map();

  constructor(
    private readonly providerAPI: typeof ProviderAPI,
    private readonly secrets: SecretStorage,
    private readonly configurationAPI: typeof ConfigurationAPI,
  ) {}

  async init(): Promise<void> {
    this.provider = this.providerAPI.createProvider({
      name: 'Vertex AI',
      status: 'unknown',
      id: 'vertex-ai',
      images: {
        icon: './icon.png',
        logo: {
          dark: './icon.png',
          light: './icon.png',
        },
      },
    });

    this.provider?.setInferenceProviderConnectionFactory({
      connectionTypes: ['cloud'],
      llmMetadata: { name: 'vertexai' },
      create: this.factory.bind(this),
    });

    await this.restoreConnections();
  }

  private async restoreConnections(): Promise<void> {
    const stored = await this.getStoredConnections();
    for (const entry of stored) {
      try {
        await this.registerInferenceProviderConnection(entry.id, entry);
      } catch (err: unknown) {
        console.error(`Vertex AI: failed to restore connection for project ${entry.projectId}`, err);
      }
    }
  }

  private async getStoredConnections(): Promise<StoredConnection[]> {
    let raw: string | undefined;
    try {
      raw = await this.secrets.get(CONNECTIONS_KEY);
    } catch (err: unknown) {
      console.error('Vertex AI: failed to read connections from secret storage', err);
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Array<VertexAiConnectionConfig & { id?: string }>;
      if (parsed.some(entry => !entry.id)) {
        const migrated: StoredConnection[] = parsed.map(entry => ({ ...entry, id: entry.id ?? randomUUID() }));
        await this.secrets.store(CONNECTIONS_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return parsed as StoredConnection[];
    } catch {
      return [];
    }
  }

  private async saveConnection(connection: StoredConnection): Promise<void> {
    const stored = await this.getStoredConnections();
    stored.push(connection);
    await this.secrets.store(CONNECTIONS_KEY, JSON.stringify(stored));
  }

  private async removeConnection(id: string): Promise<void> {
    const stored = await this.getStoredConnections();
    const filtered = stored.filter(c => c.id !== id);
    await this.secrets.store(CONNECTIONS_KEY, JSON.stringify(filtered));
  }

  private resolveCredentialsPath(credentialsFile: string): string {
    if (credentialsFile.startsWith('~')) {
      return join(homedir(), credentialsFile.slice(1));
    }
    return credentialsFile;
  }

  async readCredentials(credentialsFile: string): Promise<AdcCredentials> {
    const resolvedPath = this.resolveCredentialsPath(credentialsFile);
    const content = await readFile(resolvedPath, 'utf-8');
    const creds = JSON.parse(content) as AdcCredentials;

    if (creds.type !== 'authorized_user') {
      throw new Error(
        `Unsupported ADC type "${creds.type}" in ${resolvedPath}: expected "authorized_user". ` +
          'Run "gcloud auth application-default login" to generate user credentials.',
      );
    }

    if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
      throw new Error(`Invalid ADC credentials in ${resolvedPath}: missing required fields`);
    }

    return creds;
  }

  async exchangeToken(creds: AdcCredentials): Promise<string> {
    const body = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
    }

    const tokenData = (await response.json()) as TokenResponse;
    return tokenData.access_token;
  }

  async fetchModels(projectId: string, region: string, accessToken: string): Promise<InferenceModel[]> {
    const host = region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1beta1/publishers/anthropic/models`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': projectId,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new VertexAiApiError(await this.parseGoogleCloudError(response, projectId, region), response.status);
    }

    const data = (await response.json()) as VertexModelsResponse;
    return (data.publisherModels ?? [])
      .filter(m => m.name)
      .map(m => ({
        label: m.name.split('/').pop() ?? m.name,
      }));
  }

  private async parseGoogleCloudError(response: Response, projectId: string, region: string): Promise<string> {
    let serverMessage: string | undefined;
    try {
      const body = (await response.json()) as GoogleCloudError;
      serverMessage = body.error?.message;
    } catch {
      // response body is not JSON
    }

    switch (response.status) {
      case 400:
        return serverMessage ?? `Bad request — check that project "${projectId}" and region "${region}" are valid`;
      case 401:
        return 'Authentication expired — try running "gcloud auth application-default login" again';
      case 403:
        return (
          serverMessage ??
          `Access denied for project "${projectId}". Verify the Vertex AI API is enabled and your account has the required permissions`
        );
      case 404:
        return `Region "${region}" not found — verify it supports Anthropic models on Vertex AI`;
      default:
        return serverMessage ?? `Unexpected error: ${response.status} ${response.statusText}`;
    }
  }

  private getSecretName(connectionId: string): string {
    return `${PROVIDER_ID}:${connectionId}:token`;
  }

  private async setConnectionConfiguration(
    connection: InferenceProviderConnection,
    config: VertexAiConnectionConfig,
  ): Promise<void> {
    const secretName = this.getSecretName(connection.id);
    await this.secrets.store(secretName, this.resolveCredentialsPath(config.credentialsFile));

    const cfg = this.configurationAPI.getConfiguration(undefined, connection);
    await cfg.update('vertex-ai.connection._type', OPENSHELL_PROVIDER_ID);
    await cfg.update('vertex-ai.connection._needsInferenceSetup', true);
    await cfg.update('vertex-ai.connection.GOOGLE_APPLICATION_CREDENTIALS', secretName);
    await cfg.update('vertex-ai.connection.VERTEX_AI_PROJECT_ID', config.projectId);
    await cfg.update('vertex-ai.connection.VERTEX_AI_REGION', config.region);
  }

  private async clearConnectionConfiguration(connection: InferenceProviderConnection): Promise<void> {
    const secretName = this.getSecretName(connection.id);
    await this.secrets.delete(secretName);

    const cfg = this.configurationAPI.getConfiguration(undefined, connection);
    await cfg.update('vertex-ai.connection._type', undefined);
    await cfg.update('vertex-ai.connection._needsInferenceSetup', undefined);
    await cfg.update('vertex-ai.connection.GOOGLE_APPLICATION_CREDENTIALS', undefined);
    await cfg.update('vertex-ai.connection.VERTEX_AI_PROJECT_ID', undefined);
    await cfg.update('vertex-ai.connection.VERTEX_AI_REGION', undefined);
  }

  private async registerInferenceProviderConnection(
    id: string,
    config: VertexAiConnectionConfig,
    validatedModels?: InferenceModel[],
  ): Promise<void> {
    if (!this.provider) throw new Error('Vertex AI provider is not initialized');

    const credFile = this.resolveCredentialsPath(config.credentialsFile);

    const vertexAnthropic = createVertexAnthropic({
      project: config.projectId,
      location: config.region,
      googleAuthOptions: {
        keyFilename: credFile,
      },
    });

    const status: ProviderConnectionStatus = 'unknown';
    let models: InferenceModel[];

    if (validatedModels) {
      models = validatedModels;
    } else {
      try {
        const creds = await this.readCredentials(config.credentialsFile);
        const accessToken = await this.exchangeToken(creds);
        models = await this.fetchModels(config.projectId, config.region, accessToken);
        console.log(
          `Vertex AI: fetched ${models.length} model(s) for ${config.projectId}/${config.region}:`,
          models.map(m => m.label),
        );
      } catch (err: unknown) {
        console.warn(
          `Vertex AI: could not fetch models for ${config.projectId}/${config.region}, using fallback list`,
          err,
        );
        models = FALLBACK_MODELS;
      }
    }

    const connection: InferenceProviderConnection = {
      id,
      name: `${config.projectId} (${config.region})`,
      type: 'cloud',
      llmMetadata: {
        name: 'vertexai',
      },
      sdk: vertexAnthropic,
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
          projectId: config.projectId,
          region: config.region,
          credentialsFile: config.credentialsFile,
        };
      },
    };

    await this.setConnectionConfiguration(connection, config);

    try {
      const connectionDisposable = this.provider.registerInferenceProviderConnection(connection);
      this.connections.set(id, connectionDisposable);
    } catch (err: unknown) {
      await this.clearConnectionConfiguration(connection);
      throw err;
    }
  }

  /**
   * End-to-end validation: credentials, token exchange, and project/region reachability.
   * Returns the fetched models so the factory can pass them directly to registration.
   * On 403 (listing permission denied), falls back to a hardcoded model list so that users
   * who can invoke models but cannot list them can still create a connection.
   */
  private async validateConnection(config: VertexAiConnectionConfig): Promise<InferenceModel[]> {
    const credFile = this.resolveCredentialsPath(config.credentialsFile);

    try {
      await access(credFile);
    } catch {
      throw new Error(`Credentials file not found: ${credFile}. Run "gcloud auth application-default login" first.`);
    }

    let creds: AdcCredentials;
    try {
      creds = await this.readCredentials(config.credentialsFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid credentials file: ${msg}`);
    }

    let accessToken: string;
    try {
      accessToken = await this.exchangeToken(creds);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Authentication failed — verify your ADC credentials are current: ${msg}`);
    }

    try {
      const models = await this.fetchModels(config.projectId, config.region, accessToken);
      console.log(
        `Vertex AI: validated connection — ${models.length} model(s) for ${config.projectId}/${config.region}:`,
        models.map(m => m.label),
      );
      return models;
    } catch (err: unknown) {
      if (err instanceof VertexAiApiError && err.statusCode === 403) {
        console.warn(
          `Vertex AI: model listing denied for ${config.projectId}/${config.region}, using fallback model list`,
        );
        return FALLBACK_MODELS;
      }
      throw err;
    }
  }

  private async factory(params: { [p: string]: unknown }): Promise<void> {
    const projectId = params['vertex-ai.factory.projectId'];
    const region = params['vertex-ai.factory.region'];
    const credentialsFile = params['vertex-ai.factory.credentialsFile'];

    if (!projectId || typeof projectId !== 'string') throw new Error('Project ID is required');
    if (!region || typeof region !== 'string') throw new Error('Region is required');
    if (!credentialsFile || typeof credentialsFile !== 'string') throw new Error('Credentials file is required');

    const config: VertexAiConnectionConfig = {
      projectId: projectId.trim(),
      region: region.trim(),
      credentialsFile: credentialsFile.trim(),
    };

    const stored = await this.getStoredConnections();
    if (stored.some(c => c.projectId === config.projectId && c.region === config.region)) {
      throw new Error(`Connection already exists for project ${config.projectId} in ${config.region}`);
    }

    const models = await this.validateConnection(config);

    const id = randomUUID();
    await this.saveConnection({ id, ...config });
    try {
      await this.registerInferenceProviderConnection(id, config, models);
    } catch (err) {
      await this.removeConnection(id);
      throw err;
    }
  }

  dispose(): void {
    this.provider?.dispose();
    for (const disposable of this.connections.values()) {
      disposable.dispose();
    }
    this.connections.clear();
  }
}
