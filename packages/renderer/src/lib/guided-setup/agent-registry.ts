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
import { faCode, faDesktop, faRobot, faWrench } from '@fortawesome/free-solid-svg-icons';
import type { Component } from 'svelte';

import ClaudeCodeIcon from '/@/lib/images/agents/ClaudeCodeIcon.svelte';
import CursorIcon from '/@/lib/images/agents/CursorIcon.svelte';
import GooseIcon from '/@/lib/images/agents/GooseIcon.svelte';
import OpenCodeIcon from '/@/lib/images/agents/OpenCodeIcon.svelte';

import type { CliAgent } from './guided-setup-steps';
import OpenCodePanel from './panels/OpenCodePanel.svelte';

export interface AgentDefinition {
  cliName: CliAgent;
  title: string;
  description: string;
  badge: string;
  icon: IconDefinition;
  iconComponent?: Component;
  panel?: Component;
}

export const agentDefinitions: AgentDefinition[] = [
  {
    cliName: 'opencode',
    title: 'OpenCode',
    description:
      'Open-source agent on your machine — local models via Ollama or Ramalama, or cloud APIs (OpenAI, Gemini, and other providers OpenCode supports).',
    badge: 'Recommended',
    icon: faDesktop,
    iconComponent: OpenCodeIcon,
    panel: OpenCodePanel,
  },
  {
    cliName: 'claude',
    title: 'Claude Code',
    description: 'Anthropic Claude in the terminal — uses the Anthropic API or your org bridge.',
    badge: '',
    icon: faRobot,
    iconComponent: ClaudeCodeIcon,
  },
  {
    cliName: 'cursor',
    title: 'Cursor',
    description: 'AI-powered code editor agent with deep IDE integration.',
    badge: '',
    icon: faCode,
    iconComponent: CursorIcon,
  },
  {
    cliName: 'goose',
    title: 'Goose',
    description: 'Open-source autonomous coding agent by Block.',
    badge: '',
    icon: faWrench,
    iconComponent: GooseIcon,
  },
];
