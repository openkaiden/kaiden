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

import type { CatalogModelInfo, InferenceConnectionSummary, ModelInfo } from '/@api/model-registry-info';
import type { SemanticRouterInfo } from '/@api/semantic-router-info';

import {
  filterModelsBySearch,
  getModelId,
  searchableConnectionText,
  searchableModelText,
  searchableRouterText,
} from './models-utils';

test('getModelId builds id from llmMetadata.name, label and endpoint', () => {
  const model: ModelInfo = {
    providerId: 'p',
    connectionId: 'conn-0',
    connectionName: 'c',
    type: 'cloud',
    llmMetadata: { name: 'claude' },
    endpoint: 'https://api.example.com',
    label: 'claude-3',
  } as ModelInfo;

  expect(getModelId(model)).toBe('claude::claude-3::https://api.example.com');
});

test('getModelId handles missing llmMetadata and endpoint', () => {
  const model: ModelInfo = {
    providerId: 'p',
    connectionId: 'conn-0',
    connectionName: 'c',
    type: 'cloud',
    label: 'gpt-4',
  };

  expect(getModelId(model)).toBe('::gpt-4::');
});

test('searchableModelText joins label, provider id, provider name and connection name', () => {
  const model: CatalogModelInfo = {
    providerId: 'openai',
    connectionId: 'conn-1',
    connectionName: 'OpenAI',
    type: 'cloud',
    label: 'gpt-5-chat',
    connectionStatus: 'started',
    providerName: 'OpenAI',
  };

  expect(searchableModelText(model)).toBe('gpt-5-chat openai OpenAI OpenAI');
});

const gptModel: CatalogModelInfo = {
  providerId: 'openai',
  connectionId: 'conn-1',
  connectionName: 'OpenAI',
  type: 'cloud',
  label: 'gpt-5-chat',
  connectionStatus: 'started',
  providerName: 'OpenAI',
};

const geminiModel: CatalogModelInfo = {
  providerId: 'gemini',
  connectionId: 'conn-2',
  connectionName: 'Gemini',
  type: 'cloud',
  label: 'gemini-2.5-pro',
  connectionStatus: 'started',
  providerName: 'Gemini',
};

test('filterModelsBySearch keeps the models matching every query token', () => {
  expect(filterModelsBySearch([gptModel, geminiModel], 'chat 5')).toEqual([gptModel]);
});

test('filterModelsBySearch searches the provider id', () => {
  expect(filterModelsBySearch([gptModel, geminiModel], 'gemini pro')).toEqual([geminiModel]);
});

test('filterModelsBySearch returns every model for an empty query', () => {
  expect(filterModelsBySearch([gptModel, geminiModel], '')).toEqual([gptModel, geminiModel]);
});

test('filterModelsBySearch returns no model when a token is missing', () => {
  expect(filterModelsBySearch([gptModel, geminiModel], 'gpt xyz')).toEqual([]);
});

const connection: InferenceConnectionSummary = {
  providerName: 'Acme Gateway',
  providerId: 'acme',
  providerInternalId: 'acme.internal',
  connectionId: 'acme-conn',
  connectionType: 'cloud',
  status: 'started',
  modelCount: 2,
  creationDisplayName: 'Acme',
  configurable: true,
};

test('searchableConnectionText joins the provider name and the connection type', () => {
  expect(searchableConnectionText(connection)).toBe('Acme Gateway cloud');
});

test('searchableConnectionText handles a missing connection type', () => {
  expect(searchableConnectionText({ ...connection, connectionType: undefined })).toBe('Acme Gateway');
});

const router: SemanticRouterInfo = {
  name: 'assistant-router',
  description: 'Routes chat prompts',
  listeners: [],
  routing: {
    keywords: [{ name: 'coding-keywords', operator: 'OR', keywords: ['code'], caseSensitive: false }],
    decisions: [
      {
        name: 'code-decision',
        priority: 1,
        rules: [
          {
            operator: 'AND',
            conditions: [{ type: 'keyword', name: 'coding-keywords' }],
            modelRefs: [
              { providerId: 'openai', connectionId: 'conn-1', label: 'gpt-5-chat', useReasoning: false },
              { providerId: 'gemini', connectionId: 'conn-2', label: 'gemini-2.5-pro', useReasoning: false },
            ],
          },
        ],
      },
    ],
  },
};

test('searchableRouterText joins the name, description, keyword groups, decisions and model refs', () => {
  expect(searchableRouterText(router)).toBe(
    'assistant-router Routes chat prompts coding-keywords code-decision gpt-5-chat gemini-2.5-pro',
  );
});

test('searchableRouterText handles a missing description', () => {
  expect(searchableRouterText({ ...router, description: undefined })).toBe(
    'assistant-router coding-keywords code-decision gpt-5-chat gemini-2.5-pro',
  );
});
