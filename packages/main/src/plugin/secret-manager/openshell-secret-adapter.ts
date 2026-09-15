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

import { inject, injectable } from 'inversify';

import { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type { CreateProfileOptions, OpenshellProfile } from '/@api/openshell-gateway-info.js';
import type { SecretCliBackend, SecretCreateOptions, SecretInfo, SecretName } from '/@api/secret-info.js';

/**
 * Adapts {@link OpenshellCli} provider commands to the
 * {@link SecretCliBackend} interface used by {@link SecretManager}.
 *
 * OpenShell manages credentials as "providers" rather than "secrets".
 * This adapter maps:
 *   - `createSecret`  → `openshell provider create`
 *   - `listSecrets`   → `openshell provider list`
 *   - `removeSecret`  → `openshell provider delete`
 *   - `listServices`  → `openshell provider list-profiles`
 */
@injectable()
export class OpenshellSecretAdapter implements SecretCliBackend {
  constructor(
    @inject(OpenshellCli)
    private readonly openshellCli: OpenshellCli,
  ) {}

  async createSecret(options: SecretCreateOptions, gateway?: string): Promise<SecretName> {
    if (typeof options.value === 'string') {
      throw new Error('options.value must be a record for Openshell');
    }
    await this.openshellCli.createProvider(
      {
        name: options.name,
        type: options.type,
        credentials: options.value.credentials,
        config: options.value.config,
        flags: options.value.flags,
        env: options.value.env,
      },
      gateway,
    );
    return { name: options.name };
  }

  async listSecrets(gateway?: string): Promise<SecretInfo[]> {
    return await this.openshellCli.listProviders(gateway);
  }

  async removeSecret(name: string, gateway?: string): Promise<SecretName> {
    await this.openshellCli.deleteProvider(name, gateway);
    return { name };
  }

  async listServices(): Promise<OpenshellProfile[]> {
    return this.openshellCli.listProfiles();
  }

  async createProfile(options: CreateProfileOptions, gateway?: string): Promise<void> {
    await this.openshellCli.createProfile(options, gateway);
  }
}
