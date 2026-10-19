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

import type { z } from 'zod';

import type { DecisionConfigSchema, KeywordGroupSchema } from '/@api/semantic-router-info';

export type KeywordGroupDraft = z.infer<typeof KeywordGroupSchema>;
export type DecisionConfigDraft = z.infer<typeof DecisionConfigSchema>;

export interface SemanticRouterCreateDraft {
  currentStepIndex: number;

  name: string;
  description: string;
  listenerAddress: string;
  listenerPort: number;
  timeout: number;

  keywords: KeywordGroupDraft[];
  decisions: DecisionConfigDraft[];
}

function createInitialDraft(): SemanticRouterCreateDraft {
  return {
    currentStepIndex: 0,
    name: '',
    description: '',
    listenerAddress: '0.0.0.0',
    listenerPort: 8899,
    timeout: 300,
    keywords: [],
    decisions: [],
  };
}

export const routerWizard = $state<{ draft: SemanticRouterCreateDraft }>({ draft: createInitialDraft() });

export function resetRouterDraft(): void {
  routerWizard.draft = createInitialDraft();
}
