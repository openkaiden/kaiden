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

import type { SecretCreateOptions } from '/@api/secret-info.js';

export const SelectableProviderFactoryToken = Symbol.for('SelectableProviderFactory');

export interface ProviderFactory {
  createProvider(client: OpenShellClient, options: SecretCreateOptions): Promise<void>;
}

export interface SelectableProviderFactory extends ProviderFactory {
  supports(type: string): boolean;
}
