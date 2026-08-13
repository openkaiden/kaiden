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

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { InferenceProviderConnection } from '@openkaiden/api';
import { inject, injectable } from 'inversify';
import { stringify } from 'yaml';

import { IPCHandle } from '/@/plugin/api.js';
import { Directories } from '/@/plugin/directories.js';
import { ProviderRegistry } from '/@/plugin/provider-registry.js';
import { SafeStorageRegistry } from '/@/plugin/safe-storage/safe-storage-registry.js';
import { SecretManager } from '/@/plugin/secret-manager/secret-manager.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { ModelRef, SemanticRouterConfigInfo, SemanticRouterInfo } from '/@api/semantic-router-info.js';
import { SemanticRouterConfigSchema } from '/@api/semantic-router-info.js';

@injectable()
export class SemanticRouterManager {
  private configs: Map<string, SemanticRouterInfo> = new Map();

  constructor(
    @inject(ApiSenderType) private readonly apiSender: ApiSenderType,
    @inject(IPCHandle) private readonly ipcHandle: IPCHandle,
    @inject(Directories) private readonly directories: Directories,
    @inject(ProviderRegistry) private readonly providerRegistry: ProviderRegistry,
    @inject(SecretManager) private readonly secretManager: SecretManager,
    @inject(SafeStorageRegistry) private readonly safeStorageRegistry: SafeStorageRegistry,
  ) {}

  async init(): Promise<void> {
    const dir = this.directories.getSemanticRoutersDirectory();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await this.loadFromDisk();

    this.providerRegistry.onDidSetSemanticRouterConnectionFactory(() => {
      this.processUninstantiatedConfigs().catch((e: unknown) => {
        console.error('Failed to process uninstantiated semantic router configs', e);
      });
    });

    this.ipcHandle('semantic-router-manager:list', async (): Promise<SemanticRouterInfo[]> => {
      return this.list();
    });

    this.ipcHandle(
      'semantic-router-manager:findByName',
      async (_listener: unknown, name: string): Promise<SemanticRouterInfo | undefined> => {
        return this.findByName(name);
      },
    );

    this.ipcHandle(
      'semantic-router-manager:create',
      async (_listener: unknown, config: SemanticRouterConfigInfo): Promise<SemanticRouterInfo> => {
        return this.create(config);
      },
    );

    this.ipcHandle('semantic-router-manager:remove', async (_listener: unknown, name: string): Promise<void> => {
      return this.remove(name);
    });
  }

  list(): SemanticRouterInfo[] {
    return Array.from(this.configs.values());
  }

  findByName(name: string): SemanticRouterInfo | undefined {
    return this.configs.get(name);
  }

  async create(config: SemanticRouterConfigInfo): Promise<SemanticRouterInfo> {
    const parsed = {
      ...SemanticRouterConfigSchema.parse(config),
      name: this.getSafeName(config.name),
    };

    if (this.configs.has(parsed.name)) {
      throw new Error(`Semantic router "${parsed.name}" already exists`);
    }
    await this.saveToDisk(parsed);

    const entry: SemanticRouterInfo = { ...parsed };
    this.configs.set(parsed.name, entry);

    const factoryResult = this.providerRegistry.getSemanticRouterFactory();
    if (factoryResult) {
      try {
        const semanticRouter = await factoryResult.factory.create({
          name: parsed.name,
          config: await this.convertToYaml(parsed),
        });
        entry.connection = {
          providerInternalId: factoryResult.internalId,
          connectionId: semanticRouter.connectionId,
        };
      } catch (err: unknown) {
        this.configs.delete(parsed.name);
        await rm(this.getFilePath(parsed.name));
        throw err;
      }
    }

    this.apiSender.send('semantic-router-update');
    return entry;
  }

  async remove(name: string): Promise<void> {
    if (!this.configs.has(name)) {
      throw new Error(`Semantic router "${name}" not found`);
    }
    await rm(this.getFilePath(name));
    this.configs.delete(name);
    this.apiSender.send('semantic-router-update');
    await this.providerRegistry.deleteInferenceConnectionBySemanticRouter(name);
  }

  private async tryInstantiate(entry: SemanticRouterInfo): Promise<void> {
    const result = this.providerRegistry.getSemanticRouterFactory();
    if (result) {
      try {
        const connection = await result.factory.create({ name: entry.name, config: await this.convertToYaml(entry) });
        entry.connection = {
          providerInternalId: result.internalId,
          connectionId: connection.connectionId,
        };
      } catch (err: unknown) {
        console.error('Failed to create semantic router', err);
        /* empty */
      }
    }
  }

  async processUninstantiatedConfigs(): Promise<void> {
    for (const [, entry] of this.configs) {
      if (!entry.connection) {
        await this.tryInstantiate(entry);
      }
    }
  }

  getModelKey(model: { providerId: string; connectionId: string; label: string }): string {
    return `${model.providerId}::${model.connectionId}::${model.label}`;
  }

  async convertToYaml(config: SemanticRouterConfigInfo): Promise<string> {
    const models = new Map<
      string,
      { endpoint: string; protocol: string; label: string; api_format: string; api_key?: string }
    >();

    for (const decision of config.routing.decisions) {
      for (const rule of decision.rules) {
        for (const ref of rule.modelRefs) {
          await this.addModelIfRequired(ref, models);
        }
      }
    }
    if (config.routing.defaultModelRef !== undefined) {
      await this.addModelIfRequired(config.routing.defaultModelRef, models);
    }

    const yamlConfig: Record<string, unknown> = {
      version: 'v0.3',
      listeners: config.listeners.map(l => ({
        name: `http-${l.port}`,
        address: l.address,
        port: l.port,
        ...(l.timeout !== undefined && { timeout: `${l.timeout}s` }),
      })),
      providers: {
        models: Array.from(models.entries()).map(([name, { endpoint, label, protocol, api_format, api_key }]) => ({
          name,
          provider_model_id: label,
          backend_refs: [
            {
              name: 'primary',
              endpoint: api_format === 'gemini' ? `${endpoint}/v1beta/openai` : endpoint,
              protocol,
              weight: 100,
              api_key,
            },
          ],
        })),
        defaults: {
          default_model: config.routing.defaultModelRef ? this.getModelKey(config.routing.defaultModelRef) : undefined,
        },
      },
      routing: {
        modelCards: Array.from(models.entries()).map(([name, _unused]) => ({
          name,
          //modality: 'text',
          //capabilities: ['chat', 'reasoning', 'thinking'],
        })),
        signals: {
          keywords: config.routing.keywords.map(k => ({
            name: k.name,
            operator: k.operator,
            keywords: k.keywords,
            case_sensitive: k.caseSensitive,
          })),
        },
        decisions: config.routing.decisions.map(d => {
          const allConditions = d.rules.flatMap(r => r.conditions);
          const allModelRefs = d.rules.flatMap(r => r.modelRefs);

          return {
            name: d.name,
            ...{ description: d.description ?? d.name },
            priority: d.priority,
            rules: {
              operator: d.rules[0]?.operator ?? 'AND',
              conditions: allConditions.map(c => ({ type: c.type, name: c.name })),
            },
            modelRefs: allModelRefs.map(ref => ({
              model: this.getModelKey(ref),
              use_reasoning: ref.useReasoning,
            })),
          };
        }),
      },
      global: {
        router: {
          auto_model_name: `Semantic Router ${config.name}`,
        },
        services: {
          router_replay: {
            enabled: true,
            store_backend: 'memory',
          },
        },
      },
    };

    return stringify(yamlConfig);
  }

  private async getApiKey(connection: InferenceProviderConnection, providerId: string): Promise<string | undefined> {
    const provider = this.providerRegistry.getProvider(providerId);
    const { config, connectionProperties } = this.secretManager.getConnectionProperties(connection, provider);
    const configKeys = connectionProperties
      .filter(([fullKey, _schema]) => !fullKey.endsWith('._type') && !fullKey.endsWith('._flags'))
      .filter(([_fullKey, schema]) => schema.format === 'password');
    if (configKeys.length > 0) {
      const name = configKeys[0]?.[0];
      if (name !== undefined) {
        const secretName = config.get<string>(name);
        if (secretName !== undefined) {
          const extensionStorage = this.safeStorageRegistry.getExtensionStorage(provider.extensionId);
          return extensionStorage.get(secretName);
        }
      }
    }
    return undefined;
  }

  private async addModelIfRequired(
    ref: ModelRef,
    models: Map<string, { endpoint: string; protocol: string; label: string; api_format: string; api_key?: string }>,
  ): Promise<void> {
    const key = this.getModelKey(ref);
    if (!models.has(key)) {
      const connection = this.providerRegistry.getInferenceConnection(ref.providerId, ref.connectionId);
      const apiKey = await this.getApiKey(connection, ref.providerId);
      const rawEndpoint = connection.endpoint;
      if (rawEndpoint) {
        const url = new URL(rawEndpoint);
        models.set(key, {
          endpoint: url.host,
          protocol: url.protocol.replace(':', ''),
          label: ref.label,
          api_format: connection.llmMetadata?.name ?? 'openai',
          api_key: apiKey,
        });
      }
    }
  }

  private async loadFromDisk(): Promise<void> {
    const dir = this.directories.getSemanticRoutersDirectory();
    if (!existsSync(dir)) {
      return;
    }
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await readFile(join(dir, entry), 'utf-8');
        const config = SemanticRouterConfigSchema.parse(JSON.parse(raw));
        this.configs.set(config.name, config);
      } catch (e: unknown) {
        console.error(`Failed to load semantic router configuration file "${entry}"`, e);
      }
    }
  }

  private async saveToDisk(config: SemanticRouterConfigInfo): Promise<void> {
    await writeFile(this.getFilePath(config.name), JSON.stringify(config, undefined, 2) + '\n', 'utf-8');
  }

  private getSafeName(input: string): string {
    const normalized = input.trim().replace(/[\\/]/g, '-');
    if (!normalized || normalized === '.' || normalized === '..' || basename(normalized) !== normalized) {
      throw new Error('Invalid semantic router name');
    }
    return normalized;
  }

  private getFilePath(name: string): string {
    const safeName = this.getSafeName(name);
    return join(this.directories.getSemanticRoutersDirectory(), `${safeName}.json`);
  }
}
