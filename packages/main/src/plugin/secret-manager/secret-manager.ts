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

import { IPCHandle } from '/@/plugin/api.js';
import { KdnCli } from '/@/plugin/kdn-cli/kdn-cli.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { SecretCreateOptions, SecretInfo, SecretName, SecretService } from '/@api/secret-info.js';

/**
 * Manages secrets by delegating to the `kdn` CLI.
 */
@injectable()
export class SecretManager {
  constructor(
    @inject(ApiSenderType)
    private readonly apiSender: ApiSenderType,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(KdnCli)
    private readonly kdnCli: KdnCli,
  ) {}

  async create(options: SecretCreateOptions): Promise<SecretName> {
    const result = await this.kdnCli.createSecret(options);
    this.apiSender.send('secret-manager-update');
    return result;
  }

  async list(): Promise<SecretInfo[]> {
    return this.kdnCli.listSecrets();
  }

  async remove(name: string): Promise<SecretName> {
    const result = await this.kdnCli.removeSecret(name);
    this.apiSender.send('secret-manager-update');
    return result;
  }

  async listServices(): Promise<SecretService[]> {
    return this.kdnCli.listServices();
  }

  init(): void {
    this.ipcHandle(
      'secret-manager:create',
      async (_listener: unknown, options: SecretCreateOptions): Promise<SecretName> => {
        return this.create(options);
      },
    );

    this.ipcHandle('secret-manager:list', async (): Promise<SecretInfo[]> => {
      return this.list();
    });

    this.ipcHandle('secret-manager:remove', async (_listener: unknown, name: string): Promise<SecretName> => {
      return this.remove(name);
    });

    this.ipcHandle('secret-manager:list-services', async (): Promise<SecretService[]> => {
      return this.listServices();
    });
  }
}
