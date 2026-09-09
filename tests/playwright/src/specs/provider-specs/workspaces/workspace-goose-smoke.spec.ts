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

import { expect, test } from '/@/fixtures/provider-fixtures';
import { CODING_AGENT, TERMINAL_READY_PATTERNS } from '/@/model/core/types';

import { registerWorkspaceLifecycleTests } from './helpers/workspace-lifecycle-helper';

test.describe.serial('Goose agent workspace with OpenAI model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OPENAI',
    workspaceName: 'goose-openai',
    agent: CODING_AGENT.GOOSE,
    requiredResource: 'openai',
    selectModel: async createPage => createPage.searchAndSelectDefault('chat'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.GOOSE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit|quota exceeded/i,
    },
  });
});

test.describe.serial('Goose agent workspace without a project folder', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OPENAI-NOFOLDER',
    workspaceName: 'goose-nofolder',
    agent: CODING_AGENT.GOOSE,
    requiredResource: 'openai',
    noProjectFolder: true,
    selectModel: async createPage => createPage.searchAndSelectDefault('chat'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.GOOSE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit|quota exceeded/i,
    },
  });
});

test.describe.serial('Goose agent workspace with Mistral model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-MISTRAL',
    workspaceName: 'goose-mistral',
    agent: CODING_AGENT.GOOSE,
    requiredResource: 'mistral',
    selectModel: async createPage => createPage.searchAndSelectDefault('mistral', 'Mistral'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.GOOSE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit/i,
    },
  });
});

test.describe.serial('Goose agent workspace with Ollama model', { tag: '@workspace-provider' }, () => {
  test.skip(true, 'Skipped until https://github.com/openkaiden/kaiden/issues/1780 is fixed');

  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OLLAMA',
    workspaceName: 'goose-ollama',
    agent: CODING_AGENT.GOOSE,
    requiredResource: 'ollama',
    selectModel: async createPage => createPage.searchAndSelectByRuntime('ollama', 'Ollama'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.GOOSE,
    promptTimeout: 120_000,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579/,
    },
  });
});

test.describe.serial('Goose agent workspace with RamaLama model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-RAMALAMA',
    workspaceName: 'goose-ramalama',
    agent: CODING_AGENT.GOOSE,
    requiredResource: 'ramalama',
    selectModel: async createPage => createPage.searchAndSelectByRuntime('ramalama', 'RamaLama'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.GOOSE,
    promptTimeout: 120_000,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579/,
    },
  });
});
