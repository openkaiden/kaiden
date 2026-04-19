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
import { MistralInferenceManager } from '/@/manager/mistral-inference-manager';
import { MistralSkillsManager } from '/@/manager/mistral-skills-manager';

export class MistralExtension {
  #extensionContext: ExtensionContext;

  #inversifyBinding: InversifyBinding | undefined;
  #container: Container | undefined;
  #mistralSkillsManager: MistralSkillsManager | undefined;
  #mistralInferenceManager: MistralInferenceManager | undefined;

  constructor(extensionContext: ExtensionContext) {
    this.#extensionContext = extensionContext;
  }

  async activate(): Promise<void> {
    const mistralProvider = provider.createProvider({
      name: 'Mistral',
      status: 'unknown',
      id: 'mistral',
      images: {
        icon: './icon.png',
        logo: {
          dark: './icon.png',
          light: './icon.png',
        },
      },
    });

    this.#inversifyBinding = new InversifyBinding(mistralProvider, this.#extensionContext);
    this.#container = await this.#inversifyBinding.initBindings();

    try {
      this.#mistralSkillsManager = await this.getContainer()?.getAsync(MistralSkillsManager);
    } catch (e) {
      console.error('Error while creating the Mistral skills manager', e);
      throw e;
    }

    try {
      this.#mistralInferenceManager = await this.getContainer()?.getAsync(MistralInferenceManager);
    } catch (e) {
      console.error('Error while creating the Mistral inference manager', e);
      throw e;
    }

    await this.#mistralSkillsManager?.init();
    await this.#mistralInferenceManager?.init();
  }

  protected getContainer(): Container | undefined {
    return this.#container;
  }

  async deactivate(): Promise<void> {
    await this.#inversifyBinding?.dispose();
    this.#mistralSkillsManager?.dispose();
    this.#mistralSkillsManager = undefined;
    this.#mistralInferenceManager?.dispose();
    this.#mistralInferenceManager = undefined;
  }
}
