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

import { type Writable, writable } from 'svelte/store';

import { ChatSettings } from '/@api/chat/chat-settings';

import { configurationProperties } from './configurationProperties';

const SHOW_CHAT_WINDOW = `${ChatSettings.SectionName}.${ChatSettings.ShowChatWindow}`;
let requestId = 0;

// undefined = config not yet loaded, true/false = loaded value
export const showChatWindow: Writable<boolean | undefined> = writable();

// Re-read on configuration updates (fires on system-ready, extensions-started, configuration-changed, etc.)
configurationProperties.subscribe(() => {
  if (!window?.getConfigurationValue) {
    return;
  }

  const currentRequestId = ++requestId;
  window
    .getConfigurationValue<boolean>(SHOW_CHAT_WINDOW)
    ?.then(value => {
      if (currentRequestId === requestId) {
        showChatWindow.set(value === true);
      }
    })
    ?.catch((err: unknown) => console.error(`Error getting configuration value ${SHOW_CHAT_WINDOW}`, err));
});
