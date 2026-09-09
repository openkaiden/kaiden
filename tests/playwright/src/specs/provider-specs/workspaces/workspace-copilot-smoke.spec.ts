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

test.describe.serial('GitHub Copilot agent workspace with OpenAI model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-OPENAI',
    workspaceName: 'copilot-openai',
    agent: CODING_AGENT.COPILOT,
    requiredResource: 'openai',
    selectModel: async createPage => createPage.searchAndSelectDefault('chat'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.COPILOT,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit|quota exceeded/i,
    },
  });
});

test.describe.serial('GitHub Copilot agent workspace with Anthropic model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-ANTHROPIC',
    workspaceName: 'copilot-anthropic',
    agent: CODING_AGENT.COPILOT,
    requiredResource: 'claude',
    selectModel: async createPage => createPage.searchAndSelectDefault('claude', 'Claude'),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.COPILOT,
    promptTest: {
      prompt: 'what is 2+2? reply with just the number',
      expectedResponse: /4|insufficient|balance|credit/i,
    },
  });
});
