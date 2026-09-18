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

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { injectable } from 'inversify';

import { ProviderFactory } from '/@/plugin/secret-manager/provider-factory.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

@injectable()
export class DefaultProviderFactory implements ProviderFactory {
  async createProvider(client: OpenShellClient, options: SecretCreateOptions): Promise<void> {
    const value = options.value;
    if (typeof value === 'string') {
      throw new Error('options.value must be a record for Openshell');
    }
    if (Object.keys(value.credentials).length === 0) {
      throw new Error('credentials must not be empty');
    }
    await client.raw.createProvider({
      provider: {
        metadata: { name: options.name },
        type: options.type,
        credentials: value.credentials,
        config: value.config ?? {},
      },
      workspace: '',
    });
  }
}
