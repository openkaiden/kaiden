/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import type { AgentWorkspaceContext, ExtensionContext } from '@openkaiden/api';
import { agents, provider } from '@openkaiden/api';
import { z } from 'zod';

import { Gemini } from './gemini';

export const GEMINI_SETTINGS_PATH = '.gemini/settings.json';

const GeminiSettingsSchema = z.looseObject({
  model: z.looseObject({ name: z.string() }).optional(),
});

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  console.log('starting gemini extension');

  const gemini = new Gemini(provider, extensionContext.secrets);
  extensionContext.subscriptions.push(gemini);

  await gemini.init();

  const disposable = agents.registerAgent({
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Google cloud agent — connect with an API key to access Gemini models.',
    icon: {
      icon: './icon.png',
      logo: { dark: './icon.png', light: './icon.png' },
    },
    command: 'gemini',
    baseImage:
      'ghcr.io/openkaiden/openshell-image-gemini@sha256:e5749e6d720f8b6bc42dcc1651fbbefd2bcc04a029fb6585a32535e4b156a8d2',
    acp: { args: ['--acp'] },
    tags: ['Cloud'],
    configurationFiles: [
      {
        path: GEMINI_SETTINGS_PATH,
        async read(): Promise<string> {
          return '{}';
        },
      },
    ],
    destinationSkillsFolder: '${HOME}/.gemini/skills',
    isSupportedModelType(type): boolean {
      return type.name === 'gemini';
    },
    async preWorkspaceStart(context: AgentWorkspaceContext): Promise<void> {
      const configFile = context.configurationFiles.find(f => f.path === GEMINI_SETTINGS_PATH);
      if (!configFile) {
        return;
      }

      const config = GeminiSettingsSchema.parse(JSON.parse(await configFile.read()));
      const modelName = context.model.model.label;
      config.model = { name: modelName };

      await configFile.update(JSON.stringify(config, undefined, 2));
    },
  });
  extensionContext.subscriptions.push(disposable);
}

export function deactivate(): void {
  console.log('stopping gemini extension');
}
