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

import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import * as modelsStore from '/@/kaiden/stores/models';
import type { SemanticRouterConfigInfo } from '/@api/semantic-router-info';

import SemanticRouterCards from './SemanticRouterCards.svelte';

vi.mock(import('/@/kaiden/stores/models'));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([
    {
      providerId: 'ollama',
      connectionId: 'conn-2',
      connectionName: 'Ollama',
      type: 'local',
      label: 'qwen3-coder',
      connectionStatus: 'started',
      providerName: 'Ollama',
    },
    {
      providerId: 'gemini',
      connectionId: 'conn-1',
      connectionName: 'Gemini',
      type: 'cloud',
      label: 'gemini-2.5-pro',
      connectionStatus: 'started',
      providerName: 'Gemini',
    },
    {
      providerId: 'openshift-ai',
      connectionId: 'conn-3',
      connectionName: 'OpenShift AI',
      type: 'self-hosted',
      label: 'llama-3.1-70b',
      connectionStatus: 'started',
      providerName: 'OpenShift AI',
    },
  ]);
});

const mockRouter: SemanticRouterConfigInfo = {
  name: 'coding-router',
  description: 'Routes coding requests',
  listeners: [{ address: '0.0.0.0', port: 8899 }],
  routing: {
    keywords: [
      { name: 'coding-keywords', operator: 'OR', keywords: ['code', 'debug'], caseSensitive: false },
      { name: 'review-keywords', operator: 'AND', keywords: ['review', 'PR'], caseSensitive: false },
    ],
    decisions: [
      {
        name: 'code-decision',
        priority: 1,
        rules: [
          {
            operator: 'AND',
            conditions: [{ type: 'keyword', name: 'coding-keywords' }],
            modelRefs: [
              { providerId: 'gemini', connectionId: 'conn-1', label: 'gemini-2.5-pro', useReasoning: false },
              { providerId: 'ollama', connectionId: 'conn-2', label: 'qwen3-coder', useReasoning: true },
            ],
          },
        ],
      },
    ],
  },
};

const mockRouterNoListeners: SemanticRouterConfigInfo = {
  name: 'empty-router',
  listeners: [],
  routing: {
    keywords: [],
    decisions: [],
  },
};

test('should render the router name', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('coding-router')).toBeInTheDocument();
});

test('should render the endpoint from the first listener', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('localhost:8899')).toBeInTheDocument();
});

test('should render unique model refs as backend entries', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
  expect(screen.getByText('qwen3-coder')).toBeInTheDocument();
});

test('should render keyword group names as feature badges', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('coding-keywords')).toBeInTheDocument();
  expect(screen.getByText('review-keywords')).toBeInTheDocument();
});

test('should render the flow diagram labels', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('Agents')).toBeInTheDocument();
  expect(screen.getByText('Router')).toBeInTheDocument();
  expect(screen.getByText('Backends')).toBeInTheDocument();
});

test('should render multiple router cards', () => {
  render(SemanticRouterCards, { routers: [mockRouter, mockRouterNoListeners] });

  expect(screen.getByText('coding-router')).toBeInTheDocument();
  expect(screen.getByText('empty-router')).toBeInTheDocument();
});

test('should render the list container with correct aria label', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByRole('list', { name: 'Semantic Routers' })).toBeInTheDocument();
});

test('should show local badge for ollama provider', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('local')).toBeInTheDocument();
});

test('should show cloud badge for gemini provider', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.getByText('cloud')).toBeInTheDocument();
});

test('should show in-house badge for self-hosted provider', () => {
  const routerWithSelfHosted: SemanticRouterConfigInfo = {
    name: 'corp-router',
    listeners: [{ address: '0.0.0.0', port: 9000 }],
    routing: {
      keywords: [],
      decisions: [
        {
          name: 'decision-1',
          priority: 1,
          rules: [
            {
              operator: 'OR',
              conditions: [],
              modelRefs: [
                { providerId: 'openshift-ai', connectionId: 'c1', label: 'llama-3.1-70b', useReasoning: false },
              ],
            },
          ],
        },
      ],
    },
  };

  render(SemanticRouterCards, { routers: [routerWithSelfHosted] });

  expect(screen.getByText('in-house')).toBeInTheDocument();
});

test('should show default badge for the default model', () => {
  const routerWithDefault: SemanticRouterConfigInfo = {
    ...mockRouter,
    routing: {
      ...mockRouter.routing,
      defaultModelRef: { providerId: 'gemini', connectionId: 'conn-1', label: 'gemini-2.5-pro', useReasoning: false },
    },
  };

  render(SemanticRouterCards, { routers: [routerWithDefault] });

  expect(screen.getByText('default')).toBeInTheDocument();
});

test('should not show default badge when no defaultModelRef is set', () => {
  render(SemanticRouterCards, { routers: [mockRouter] });

  expect(screen.queryByText('default')).not.toBeInTheDocument();
});

test('should deduplicate model refs across rules', () => {
  const routerWithDuplicates: SemanticRouterConfigInfo = {
    name: 'dup-router',
    listeners: [{ address: '0.0.0.0', port: 9000 }],
    routing: {
      keywords: [],
      decisions: [
        {
          name: 'decision-1',
          priority: 1,
          rules: [
            {
              operator: 'OR',
              conditions: [],
              modelRefs: [{ providerId: 'gemini', connectionId: 'c1', label: 'gemini-2.5-pro', useReasoning: false }],
            },
          ],
        },
        {
          name: 'decision-2',
          priority: 2,
          rules: [
            {
              operator: 'OR',
              conditions: [],
              modelRefs: [
                { providerId: 'gemini', connectionId: 'c1', label: 'gemini-2.5-pro', useReasoning: false },
                { providerId: 'ollama', connectionId: 'c2', label: 'granite-3.3-8b', useReasoning: true },
              ],
            },
          ],
        },
      ],
    },
  };

  render(SemanticRouterCards, { routers: [routerWithDuplicates] });

  const geminiElements = screen.getAllByText('gemini-2.5-pro');
  expect(geminiElements).toHaveLength(1);
  expect(screen.getByText('granite-3.3-8b')).toBeInTheDocument();
});
