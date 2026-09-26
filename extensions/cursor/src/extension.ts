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

import type { AgentWorkspaceContext, ExtensionContext, ProviderProfile } from '@openkaiden/api';
import { agents, openshell } from '@openkaiden/api';
import { load } from 'js-yaml';
import { z } from 'zod';

import cursorProfileYaml from './cursor.yaml?raw';
import { CursorExtension } from './cursor-extension';

export const CURSOR_CLI_CONFIG_PATH = '.cursor/cli-config.json';

const CursorModelSchema = z.looseObject({
  modelId: z.string(),
  displayModelId: z.string(),
  displayName: z.string(),
  displayNameShort: z.string(),
  maxMode: z.boolean(),
});

const CursorCliConfigSchema = z.looseObject({
  model: CursorModelSchema.optional(),
  hasChangedDefaultModel: z.boolean().optional(),
});

let cursorExtension: CursorExtension | undefined;

export async function activate(extensionContext: ExtensionContext): Promise<void> {
  cursorExtension ??= new CursorExtension(extensionContext);
  await cursorExtension.activate();

  const disposable = agents.registerAgent({
    id: 'cursor',
    name: 'Cursor CLI',
    description: 'Cursor AI agent — connect to your Cursor instance to access AI capabilities.',
    icon: {
      icon: { dark: './APP_ICON_2D_DARK.png', light: './APP_ICON_2D_LIGHT.png' },
      logo: { dark: './APP_ICON_2D_DARK.png', light: './APP_ICON_2D_LIGHT.png' },
    },
    command: 'cursor',
    tags: ['Local'],
    configurationFiles: [
      {
        path: CURSOR_CLI_CONFIG_PATH,
        async read(): Promise<string> {
          return '{}';
        },
      },
    ],
    destinationSkillsFolder: '${HOME}/.cursor/skills',
    isSupportedModelType(type): boolean {
      return type.name === 'cursor';
    },
    async preWorkspaceStart(context: AgentWorkspaceContext): Promise<void> {
      const configFile = context.configurationFiles.find(f => f.path === CURSOR_CLI_CONFIG_PATH);
      if (!configFile) {
        return;
      }

      const config = CursorCliConfigSchema.parse(JSON.parse(await configFile.read()));
      const modelName = context.model.model.label;
      config.model = {
        modelId: modelName,
        displayModelId: modelName,
        displayName: modelName,
        displayNameShort: modelName,
        maxMode: false,
      };
      config.hasChangedDefaultModel = true;

      await configFile.update(JSON.stringify(config, undefined, 2));
    },
  });
  extensionContext.subscriptions.push(disposable);

  const profile = load(cursorProfileYaml) as ProviderProfile;
  if (!openshell.getProfiles().some(p => p.id === profile.id)) {
    extensionContext.subscriptions.push(openshell.registerProfile(profile));
  }
}

export async function deactivate(): Promise<void> {
  await cursorExtension?.deactivate();
  cursorExtension = undefined;
}
