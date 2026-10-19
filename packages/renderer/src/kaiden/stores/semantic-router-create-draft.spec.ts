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

import { expect, test } from 'vitest';

import { resetRouterDraft, routerWizard } from './semantic-router-create-draft.svelte';

test('initial draft has expected default values', () => {
  expect(routerWizard.draft.currentStepIndex).toBe(0);
  expect(routerWizard.draft.name).toBe('');
  expect(routerWizard.draft.description).toBe('');
  expect(routerWizard.draft.listenerAddress).toBe('0.0.0.0');
  expect(routerWizard.draft.listenerPort).toBe(8899);
  expect(routerWizard.draft.timeout).toBe(300);
  expect(routerWizard.draft.keywords).toEqual([]);
  expect(routerWizard.draft.decisions).toEqual([]);
});

test('resetRouterDraft restores all fields to defaults', () => {
  routerWizard.draft.currentStepIndex = 2;
  routerWizard.draft.name = 'my-router';
  routerWizard.draft.description = 'A test router';
  routerWizard.draft.listenerPort = 9000;
  routerWizard.draft.keywords = [{ name: 'sig', operator: 'OR', keywords: ['test'], caseSensitive: false }];
  routerWizard.draft.decisions = [
    {
      name: 'dec',
      priority: 100,
      rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
    },
  ];

  resetRouterDraft();

  expect(routerWizard.draft.currentStepIndex).toBe(0);
  expect(routerWizard.draft.name).toBe('');
  expect(routerWizard.draft.description).toBe('');
  expect(routerWizard.draft.listenerAddress).toBe('0.0.0.0');
  expect(routerWizard.draft.listenerPort).toBe(8899);
  expect(routerWizard.draft.timeout).toBe(300);
  expect(routerWizard.draft.keywords).toEqual([]);
  expect(routerWizard.draft.decisions).toEqual([]);
});

test('keyword and decision arrays can be mutated on draft', () => {
  routerWizard.draft.keywords = [
    { name: 'code-kw', operator: 'AND', keywords: ['function', 'class'], caseSensitive: true },
  ];
  routerWizard.draft.decisions = [
    {
      name: 'code-route',
      priority: 80,
      rules: [
        {
          operator: 'OR',
          conditions: [{ type: 'keyword', name: 'code-kw' }],
          modelRefs: [{ providerId: 'openai', connectionId: 'c1', label: 'GPT-4', useReasoning: false }],
        },
      ],
    },
  ];

  expect(routerWizard.draft.keywords).toHaveLength(1);
  expect(routerWizard.draft.keywords[0].name).toBe('code-kw');
  expect(routerWizard.draft.decisions).toHaveLength(1);
  expect(routerWizard.draft.decisions[0].rules[0].conditions[0].name).toBe('code-kw');

  resetRouterDraft();
});
