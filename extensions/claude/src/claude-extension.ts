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

import type { ExtensionContext } from '@openkaiden/api';
import { provider } from '@openkaiden/api';
import type { Container } from 'inversify';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { ClaudeInferenceManager } from '/@/manager/claude-inference-manager';
import { ClaudeSkillsManager } from '/@/manager/claude-skills-manager';

export class ClaudeExtension {
  #extensionContext: ExtensionContext;

  #inversifyBinding: InversifyBinding | undefined;
  #container: Container | undefined;
  #claudeSkillsManager: ClaudeSkillsManager | undefined;
  #claudeInferenceManager: ClaudeInferenceManager | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const claudeProvider = provider.createProvider({
      name: 'Claude',
      status: 'unknown',
      id: 'claude',
      images: {
        icon: './icon.png',
        logo: {
          dark: './icon.png',
          light: './icon.png',
        },
      },
    });

    this.#inversifyBinding = new InversifyBinding(claudeProvider, this.#extensionContext);
    this.#container = await this.#inversifyBinding.initBindings();

    try {
      this.#claudeSkillsManager = await this.getContainer()?.getAsync(ClaudeSkillsManager);
    } catch (e) {
      console.error('Error while creating the Claude skills manager', e);
      throw e;
    }

    try {
      this.#claudeInferenceManager = await this.getContainer()?.getAsync(ClaudeInferenceManager);
    } catch (e) {
      console.error('Error while creating the Claude inference manager', e);
      throw e;
    }

    await this.#claudeSkillsManager?.init();
    await this.#claudeInferenceManager?.init();
  }

  protected getContainer(): Container | undefined {
    return this.#container;
  }

  async deactivate(): Promise<void> {
    await this.#inversifyBinding?.dispose();
    this.#claudeSkillsManager?.dispose();
    this.#claudeSkillsManager = undefined;
    this.#claudeInferenceManager?.dispose();
    this.#claudeInferenceManager = undefined;
  }
}
