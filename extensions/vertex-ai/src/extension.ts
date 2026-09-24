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

import type { ExtensionContext, ProviderProfile } from '@openkaiden/api';
import { configuration, openshell, provider } from '@openkaiden/api';
import { load } from 'js-yaml';

import vertexAiProfileYaml from './google-vertex-ai.yaml?raw';
import { VertexAi } from './vertex-ai';

let vertexAi: VertexAi | undefined;

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  console.log('starting vertex-ai extension');

  vertexAi = new VertexAi(provider, extensionContext.secrets, configuration);
  extensionContext.subscriptions.push(vertexAi);

  await vertexAi.init();

  const profile = load(vertexAiProfileYaml) as ProviderProfile;
  if (!openshell.getProfiles().some(p => p.id === profile.id)) {
    extensionContext.subscriptions.push(openshell.registerProfile(profile));
  }
}

export function deactivate(): void {
  console.log('stopping vertex-ai extension');
  vertexAi = undefined;
}
