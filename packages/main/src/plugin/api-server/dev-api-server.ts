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

import { app } from 'electron';
import { injectable, injectFromBase } from 'inversify';

import { ApiServer } from '/@/plugin/api-server/api-server.js';

/**
 * API server of a dev instance: it publishes its port file in the per-checkout userData directory
 * (see AppIdentityDevPlugin), so it never overwrites the port file of the packaged app or of another checkout.
 */
@injectable()
@injectFromBase()
export class DevApiServer extends ApiServer {
  protected override portFileDirectory(): string {
    return app.getPath('userData');
  }
}
