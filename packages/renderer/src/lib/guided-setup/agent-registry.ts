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
import { faCode, faDesktop, faO, faRobot, faWrench } from '@fortawesome/free-solid-svg-icons';
import type { Component } from 'svelte';

import type { CliAgent } from './guided-setup-steps';
import OpenCodePanel from './panels/OpenCodePanel.svelte';

export interface AgentDefinition {
  cliName: CliAgent;
  title: string;
  icon: IconDefinition;
  colorClass: string;
  description?: string;
  badge?: string;
  panel?: Component;
}

const DEFAULT_DEFINITION: Omit<AgentDefinition, 'cliName' | 'title'> = {
  icon: faRobot,
  colorClass: 'bg-gradient-to-br from-purple-500 to-purple-600',
};

export const agentDefinitions: AgentDefinition[] = [
  {
    cliName: 'opencode',
    title: 'OpenCode',
    icon: faDesktop,
    colorClass: 'bg-gradient-to-br from-green-500 to-green-600',
    description:
      'Open-source agent on your machine - local models via Ollama or Ramalama, or cloud APIs (OpenAI, Gemini, and other providers OpenCode supports).',
    badge: 'Recommended',
    panel: OpenCodePanel,
  },
  {
    cliName: 'claude',
    title: 'Claude',
    icon: faRobot,
    colorClass: 'bg-gradient-to-br from-amber-600 to-amber-500',
  },
  {
    cliName: 'goose',
    title: 'Goose',
    icon: faWrench,
    colorClass: 'bg-gradient-to-br from-red-600 to-red-700',
  },
  {
    cliName: 'cursor',
    title: 'Cursor',
    icon: faCode,
    colorClass: 'bg-gradient-to-br from-sky-500 to-sky-600',
  },
  {
    cliName: 'codex',
    title: 'Codex',
    icon: faO,
    colorClass: 'bg-gradient-to-br from-green-500 to-green-600',
  },
];

const agentMap = new Map(agentDefinitions.map(d => [d.cliName, d]));

export function getAgentDefinition(name: string): AgentDefinition {
  return agentMap.get(name as CliAgent) ?? { ...DEFAULT_DEFINITION, cliName: name as CliAgent, title: name };
}
