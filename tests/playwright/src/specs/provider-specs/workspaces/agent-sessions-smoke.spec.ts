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

import { test } from '/@/fixtures/provider-fixtures';
import { CODING_AGENT } from '/@/model/core/types';

import { registerSessionLifecycleTests } from './helpers/session-lifecycle-helper';
import {
  createSessionStep,
  deleteSessionStep,
  followUpSessionStep,
  permissionApproveSessionStep,
  permissionDenySessionStep,
  renameSessionStep,
  searchFilterSessionStep,
  staleSandboxSessionStep,
  stopSessionStep,
} from './helpers/session-steps';

const MODEL_RESPONSE_TIMEOUT = 120_000;

registerSessionLifecycleTests(test, {
  describeName: 'Agent session lifecycle on an OpenCode+Ollama sandbox',
  tags: ['@workspace-provider'],
  workspaceSetup: {
    workspaceName: 'acp-e2e-workspace',
    workingDir: '/tmp/acp-e2e-project',
    sandboxLabel: 'OpenCode+Ollama',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'ollama',
    selectModel: createPage => createPage.searchAndSelectByRuntime('gemma4', 'Ollama'),
  },
  steps: [
    createSessionStep({
      initialPrompt: 'Reply with exactly the single word "pong". Do not use any tools or read any files.',
      expectedResponse: /pong/i,
      timeout: MODEL_RESPONSE_TIMEOUT,
    }),
    followUpSessionStep({
      followUpPrompt: 'Now reply with exactly the single word "pong2". Do not use any tools.',
      expectedResponse: /pong2/i,
      timeout: MODEL_RESPONSE_TIMEOUT,
    }),
    stopSessionStep({
      longRunningPrompt:
        'Write an extremely long, detailed 3000-word story about a robot exploring a forest, ' +
        'describing every plant, animal, and rock formation it encounters in extensive detail. Do not use any tools.',
      timeout: MODEL_RESPONSE_TIMEOUT,
    }),
    permissionApproveSessionStep({
      prompt: 'Use a shell tool to run `echo hello-world` and tell me the exact output.',
      timeout: MODEL_RESPONSE_TIMEOUT,
    }),
    permissionDenySessionStep({
      prompt: 'Use a shell tool to run `echo goodbye-world` and tell me the exact output.',
      timeout: MODEL_RESPONSE_TIMEOUT,
    }),
    renameSessionStep({ newLabel: 'ACP smoke session' }),
    searchFilterSessionStep(),
    staleSandboxSessionStep(),
    deleteSessionStep(),
  ],
});
