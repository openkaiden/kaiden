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
import { CODING_AGENT, TERMINAL_READY_PATTERNS, TIMEOUTS } from '/@/model/core/types';

import { registerWorkspaceLifecycleTests } from './helpers/workspace-lifecycle-helper';

test.describe.serial('OpenCode agent workspace with OpenAI model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OPENAI',
    workspaceName: 'opencode-openai',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'openai',
    selectModel: async createPage => createPage.searchAndSelectDefault('chat'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTimeout: TIMEOUTS.MODEL_RESPONSE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit|quota exceeded/i,
    },
  });
});

test.describe.serial('OpenCode agent workspace without a project folder', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OPENAI-NOFOLDER',
    workspaceName: 'opencode-nofolder',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'openai',
    noProjectFolder: true,
    selectModel: async createPage => createPage.searchAndSelectDefault('chat'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTimeout: TIMEOUTS.MODEL_RESPONSE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit|quota exceeded/i,
    },
  });
});

test.describe.serial('OpenCode agent workspace with Gemini model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-GEMINI',
    workspaceName: 'opencode-gemini',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'gemini',
    selectModel: async createPage => createPage.searchAndSelectDefault('gemini', 'Gemini'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit/i,
    },
  });
});

test.describe.serial('OpenCode agent workspace with Anthropic model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-ANTHROPIC',
    workspaceName: 'opencode-anthropic',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'claude',
    selectModel: async createPage => createPage.searchAndSelectDefault('claude', 'Claude'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTest: {
      prompt: 'what is 2+2? reply with just the number',
      expectedResponse: /4|insufficient|balance|credit/i,
    },
  });
});

test.describe.serial('OpenCode agent workspace with Mistral model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-MISTRAL',
    workspaceName: 'opencode-mistral',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'mistral',
    selectModel: async createPage => createPage.searchAndSelectDefault('mistral', 'Mistral'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit/i,
    },
  });
});

test.describe.serial('OpenCode agent workspace with Ollama model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OLLAMA',
    workspaceName: 'opencode-ollama',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'ollama',
    selectModel: async createPage => createPage.searchAndSelectByRuntime('ollama', 'Ollama'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTimeout: 120_000,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579/,
    },
  });
});
