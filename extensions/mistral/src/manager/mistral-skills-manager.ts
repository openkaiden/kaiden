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

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Disposable, Provider } from '@openkaiden/api';
import { inject, injectable } from 'inversify';
import { parse } from 'smol-toml';

import { MistralProviderSymbol } from '/@/inject/symbol';

@injectable()
export class MistralSkillsManager {
  @inject(MistralProviderSymbol)
  private mistralProvider: Provider;

  #skillDisposables: Disposable[] = [];

  static getDefaultSkillsDir(): string {
    return join(homedir(), '.vibe', 'skills');
  }

  static getConfigPath(): string {
    return join(homedir(), '.vibe', 'config.toml');
  }

  async getSkillPaths(): Promise<string[]> {
    const paths: string[] = [MistralSkillsManager.getDefaultSkillsDir()];

    const configPath = MistralSkillsManager.getConfigPath();
    try {
      const content = await readFile(configPath, 'utf-8');
      const config = parse(content);
      if (Array.isArray(config.skill_paths)) {
        for (const p of config.skill_paths) {
          if (typeof p === 'string') {
            paths.push(p);
          }
        }
      }
    } catch {
      // config file doesn't exist or is invalid — proceed with default only
    }

    return paths;
  }

  async init(): Promise<void> {
    const skillPaths = await this.getSkillPaths();

    for (const skillPath of skillPaths) {
      const disposable = this.mistralProvider.registerSkill({
        label: 'Mistral',
        path: skillPath,
      });
      this.#skillDisposables.push(disposable);
    }
  }

  dispose(): void {
    for (const d of this.#skillDisposables) {
      d.dispose();
    }
    this.#skillDisposables = [];
  }
}
