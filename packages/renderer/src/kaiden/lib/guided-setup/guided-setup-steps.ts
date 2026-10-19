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
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import type { Component } from 'svelte';

import type { AgentInfo } from '/@api/agent-info';
import type { DefaultWorkspaceModelSettings, DefaultWorkspaceSettings } from '/@api/onboarding-settings-info';

import GuidedSetupPage from './GuidedSetupPage.svelte';

export type CliAgent = AgentInfo['id'];

export interface OnboardingState {
  agent: CliAgent;
  model?: DefaultWorkspaceModelSettings;
  workspaceSetting: DefaultWorkspaceSettings;
  beforeAdvance?: () => Promise<boolean>;
}

export interface GuidedSetupStepProps {
  stepId: string;
  title: string;
  description: string;
  onboarding: OnboardingState;
}

export interface GuidedSetupStep {
  id: string;
  title: string;
  stepperLabel?: string;
  description: string;
  icon: IconDefinition;
  component: Component<GuidedSetupStepProps>;
  isComplete: () => boolean;
  isSkippable: boolean;
}

export function createDefaultOnboardingState(): OnboardingState {
  return {
    agent: 'opencode',
    workspaceSetting: {},
  };
}

export const guidedSetupSteps: GuidedSetupStep[] = [
  {
    id: 'guided-setup',
    title: 'Choose your coding agent',
    stepperLabel: 'Coding agent',
    description:
      'Pick the coding agent Kaiden should prepare by default, then choose or create a compatible model connection.',
    icon: faRobot,
    component: GuidedSetupPage,
    isComplete: (): boolean => false,
    isSkippable: true,
  },
];
