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

import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faClaude } from '@fortawesome/free-brands-svg-icons';
import { faDesktop } from '@fortawesome/free-solid-svg-icons';
import type { Component } from 'svelte';

import type { CliAgent } from './guided-setup-steps';
import ClaudePanel from './panels/ClaudePanel.svelte';
import OpenCodePanel from './panels/OpenCodePanel.svelte';

export interface AgentDefinition {
  cliName: CliAgent;
  title: string;
  description: string;
  badge: string;
  icon: IconDefinition;
  panel?: Component;
  extensionId?: string;
  secretType?: string;
}

export const agentDefinitions: AgentDefinition[] = [
  {
    cliName: 'opencode',
    title: 'OpenCode',
    description:
      'Open-source agent on your machine - local models via Ollama or Ramalama, or cloud APIs (OpenAI, Gemini, and other providers OpenCode supports).',
    badge: 'Recommended',
    icon: faDesktop,
    panel: OpenCodePanel,
  },
  {
    cliName: 'claude',
    title: 'Claude Code',
    description: 'Anthropic\u2019s cloud agent \u2014 connect with an API key to access Claude models.',
    badge: 'Cloud',
    icon: faClaude,
    panel: ClaudePanel,
    extensionId: 'claude',
    secretType: 'anthropic',
  },
];
