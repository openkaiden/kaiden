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

import { fireEvent, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import type { CatalogModelInfo, InferenceConnectionSummary } from '/@/kaiden/lib/models/models-utils';
import * as inferenceConnectionSummariesStore from '/@/kaiden/stores/inference-connection-summaries';
import * as modelsStore from '/@/kaiden/stores/models';
import * as semanticRoutersStore from '/@/kaiden/stores/semantic-routers';
import type { SemanticRouterInfo } from '/@api/semantic-router-info';

import ModelsCatalog from './ModelsCatalog.svelte';

vi.mock(import('/@/kaiden/stores/models'));
vi.mock(import('/@/kaiden/stores/inference-connection-summaries'));
vi.mock(import('/@/kaiden/stores/semantic-routers'));
vi.mock(import('tinro'));

const cloudModel: CatalogModelInfo = {
  providerId: 'openai',
  connectionId: 'conn-1',
  connectionName: 'OpenAI',
  type: 'cloud',
  label: 'gpt-5-chat',
  connectionStatus: 'started',
  providerName: 'OpenAI',
};

const secondCloudModel: CatalogModelInfo = {
  providerId: 'gemini',
  connectionId: 'conn-2',
  connectionName: 'Gemini',
  type: 'cloud',
  label: 'gemini-2.5-pro',
  connectionStatus: 'started',
  providerName: 'Gemini',
};

const providerIdOnlyModel: CatalogModelInfo = {
  providerId: 'acme-cloud',
  connectionId: 'conn-3',
  connectionName: 'Acme',
  type: 'cloud',
  label: 'acme-model',
  connectionStatus: 'started',
  providerName: 'Acme LLM',
};

const cloudConnections: InferenceConnectionSummary[] = [
  {
    providerName: 'Acme Gateway',
    providerId: 'acme',
    providerInternalId: 'acme.internal',
    connectionId: 'acme-conn',
    connectionType: 'cloud',
    status: 'started',
    modelCount: 2,
    creationDisplayName: 'Acme',
    configurable: true,
  },
  {
    providerName: 'Globex On-Prem',
    providerId: 'globex',
    providerInternalId: 'globex.internal',
    connectionId: 'globex-conn',
    connectionType: 'self-hosted',
    status: 'started',
    modelCount: 1,
    creationDisplayName: 'Globex',
    configurable: true,
  },
];

const assistantRouter: SemanticRouterInfo = {
  name: 'assistant-router',
  description: 'Routes chat prompts',
  listeners: [{ address: '0.0.0.0', port: 8899 }],
  routing: {
    keywords: [{ name: 'coding-keywords', operator: 'OR', keywords: ['code'], caseSensitive: false }],
    decisions: [
      {
        name: 'code-decision',
        priority: 1,
        rules: [
          {
            operator: 'OR',
            conditions: [{ type: 'keyword', name: 'coding-keywords' }],
            modelRefs: [{ providerId: 'openai', connectionId: 'conn-1', label: 'gpt-5-chat', useReasoning: false }],
          },
        ],
      },
    ],
  },
};

const translationRouter: SemanticRouterInfo = {
  name: 'translation-router',
  description: 'Routes translation prompts',
  listeners: [{ address: '0.0.0.0', port: 8898 }],
  routing: {
    keywords: [{ name: 'translation-keywords', operator: 'OR', keywords: ['translate'], caseSensitive: false }],
    decisions: [
      {
        name: 'translation-decision',
        priority: 1,
        rules: [
          {
            operator: 'OR',
            conditions: [{ type: 'keyword', name: 'translation-keywords' }],
            modelRefs: [{ providerId: 'gemini', connectionId: 'conn-2', label: 'gemini-2.5-pro', useReasoning: false }],
          },
        ],
      },
    ],
  },
};

beforeEach(() => {
  vi.resetAllMocks();

  // SemanticRouterCards, rendered on the router tab, subscribes to catalogModels.
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([cloudModel, secondCloudModel]);
  vi.mocked(modelsStore).cloudCatalogModels = writable<CatalogModelInfo[]>([cloudModel, secondCloudModel]);
  vi.mocked(modelsStore).inHouseCatalogModels = writable<CatalogModelInfo[]>([]);
  vi.mocked(modelsStore).localCatalogModels = writable<CatalogModelInfo[]>([]);

  vi.mocked(inferenceConnectionSummariesStore).cloudConnectionSummaries =
    writable<InferenceConnectionSummary[]>(cloudConnections);
  vi.mocked(inferenceConnectionSummariesStore).inHouseConnectionSummaries = writable<InferenceConnectionSummary[]>([]);
  vi.mocked(inferenceConnectionSummariesStore).localConnectionSummaries = writable<InferenceConnectionSummary[]>([]);

  vi.mocked(semanticRoutersStore).semanticRouterInfos = writable<SemanticRouterInfo[]>([
    assistantRouter,
    translationRouter,
  ]);
});

async function searchModels(query: string): Promise<void> {
  const searchInput = screen.getByRole('textbox', { name: 'search Models' });
  await fireEvent.input(searchInput, { target: { value: query } });
}

type SearchCaseRow = [name: string, query: string, visible: string, hidden: string];

test('should display both cloud models and connection tiles when search is empty', () => {
  render(ModelsCatalog);

  expect(screen.getByText('gpt-5-chat')).toBeInTheDocument();
  expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
  expect(screen.getByText('Acme Gateway')).toBeInTheDocument();
  expect(screen.getByText('Globex On-Prem')).toBeInTheDocument();
});

const cloudModelSearchCases: SearchCaseRow[] = [
  ['should match a model when query tokens appear in a different order', 'chat-5', 'gpt-5-chat', 'gemini-2.5-pro'],
  ['should match a model when query tokens are separated by spaces', 'chat 5', 'gpt-5-chat', 'gemini-2.5-pro'],
  ['should match a model when multiple tokens all appear in the label', 'gpt chat', 'gpt-5-chat', 'gemini-2.5-pro'],
];

test.each(cloudModelSearchCases)('%s', async (name, query, visible, hidden) => {
  render(ModelsCatalog);

  await searchModels(query);

  expect(screen.getByText(visible)).toBeInTheDocument();
  expect(screen.queryByText(hidden)).not.toBeInTheDocument();
});

test('should not match a model when a token is missing from all fields', async () => {
  render(ModelsCatalog);

  await searchModels('gpt xyz');

  expect(screen.queryByText('gpt-5-chat')).not.toBeInTheDocument();
  expect(screen.queryByText('gemini-2.5-pro')).not.toBeInTheDocument();
});

test('should match a model when a token only appears in its provider id', async () => {
  vi.mocked(modelsStore).cloudCatalogModels = writable<CatalogModelInfo[]>([providerIdOnlyModel, secondCloudModel]);

  render(ModelsCatalog);

  await searchModels('acme cloud');

  expect(screen.getByText('acme-model')).toBeInTheDocument();
  expect(screen.queryByText('gemini-2.5-pro')).not.toBeInTheDocument();
});

const connectionSearchCases: SearchCaseRow[] = [
  [
    'should match a connection tile when its tokens span the provider name and the connection type',
    'acme cloud',
    'Acme Gateway',
    'Globex On-Prem',
  ],
  [
    'should match a connection tile when its tokens appear in a different order',
    'gateway acme',
    'Acme Gateway',
    'Globex On-Prem',
  ],
];

test.each(connectionSearchCases)('%s', async (name, query, visible, hidden) => {
  render(ModelsCatalog);

  await searchModels(query);

  expect(screen.getByText(visible)).toBeInTheDocument();
  expect(screen.queryByText(hidden)).not.toBeInTheDocument();
});

const routerSearchCases: SearchCaseRow[] = [
  [
    'should match a semantic router when its tokens span the name and a keyword group',
    'assistant coding',
    'assistant-router',
    'translation-router',
  ],
  [
    'should match a semantic router when its tokens span a decision and a model ref',
    'decision gpt',
    'assistant-router',
    'translation-router',
  ],
];

test.each(routerSearchCases)('%s', async (name, query, visible, hidden) => {
  render(ModelsCatalog, { initialCategory: 'router' });

  await searchModels(query);

  expect(screen.getByText(visible)).toBeInTheDocument();
  expect(screen.queryByText(hidden)).not.toBeInTheDocument();
});
