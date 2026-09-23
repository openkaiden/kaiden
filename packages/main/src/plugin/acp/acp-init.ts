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

import { AcpSettings } from '/@api/acp-settings.js';
import { type IConfigurationNode, IConfigurationRegistry } from '/@api/configuration/models.js';

@injectable()
export class AcpInit {
  constructor(@inject(IConfigurationRegistry) private configurationRegistry: IConfigurationRegistry) {}

  init(): void {
    const acpConfiguration: IConfigurationNode = {
      id: 'preferences.acp',
      title: 'ACP Sessions',
      type: 'object',
      properties: {
        [`${AcpSettings.SectionName}.${AcpSettings.MaxAttachmentFileSizeMB}`]: {
          description: 'Maximum file size (in MB) for attachments. Files exceeding this limit are rejected.',
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 100,
        },
      },
    };

    this.configurationRegistry.registerConfigurations([acpConfiguration]);
  }
}
