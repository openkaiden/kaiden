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

test.describe.serial('Claude Code agent workspace with Anthropic model', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-CLAUDE',
    workspaceName: 'claude-default',
    agent: CODING_AGENT.CLAUDE,
    requiredResource: 'claude',
    selectModel: async createPage => {
      await createPage.verifyModelRuntimes('Claude');
      return createPage.selectDefaultModel();
    },
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.CLAUDE,
    promptTest: {
      prompt: 'what is 2+2? reply with just the number',
      expectedResponse: /4|insufficient|balance|credit/i,
    },
  });
});

test.describe.serial('Claude Code agent workspace without a project folder', { tag: '@workspace-provider' }, () => {
  registerWorkspaceLifecycleTests(test, expect, {
    testIdPrefix: 'WKS-CLAUDE-NOFOLDER',
    workspaceName: 'claude-nofolder',
    agent: CODING_AGENT.CLAUDE,
    requiredResource: 'claude',
    noProjectFolder: true,
    selectModel: async createPage => {
      await createPage.verifyModelRuntimes('Claude');
      return createPage.selectDefaultModel();
    },
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.CLAUDE,
    promptTest: {
      prompt: 'what is 2+2? reply with just the number',
      expectedResponse: /4|insufficient|balance|credit/i,
    },
  });
});
