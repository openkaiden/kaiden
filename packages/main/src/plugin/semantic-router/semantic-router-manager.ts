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

import { inject, injectable } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { Directories } from '/@/plugin/directories.js';
import { ProviderRegistry } from '/@/plugin/provider-registry.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { SemanticRouterConfigInfo, SemanticRouterInfo } from '/@api/semantic-router-info.js';
import { SemanticRouterConfigSchema } from '/@api/semantic-router-info.js';

@injectable()
export class SemanticRouterManager {
  private configs: Map<string, SemanticRouterInfo> = new Map();

  constructor(
    @inject(ApiSenderType) private readonly apiSender: ApiSenderType,
    @inject(IPCHandle) private readonly ipcHandle: IPCHandle,
    @inject(Directories) private readonly directories: Directories,
    @inject(ProviderRegistry) private readonly providerRegistry: ProviderRegistry,
  ) {}

  async init(): Promise<void> {
    const dir = this.directories.getSemanticRoutersDirectory();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await this.loadFromDisk();

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
          config: JSON.stringify(parsed),
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
