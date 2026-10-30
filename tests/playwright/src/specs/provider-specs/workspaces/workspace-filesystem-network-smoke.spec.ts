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
import {
  CODING_AGENT,
  FILE_ACCESS_LEVEL,
  NETWORK_ACCESS_LEVEL,
  OPENAI_SMOKE_MODEL,
  TERMINAL_READY_PATTERNS,
} from '/@/model/core/types';

// Sandbox matrix lifecycle tests — see .agents/skills/playwright-testing/workspace-provider-e2e.md
import {
  CUSTOM_ALLOWED_HOST,
  CUSTOM_DEFAULT_TARGET_MOUNT,
  CUSTOM_MULTI_MOUNTS,
  CUSTOM_RO_MOUNT,
  CUSTOM_RW_MOUNT,
  registerSandboxMatrixTests,
  type SandboxAgentSetup,
  type SandboxScenario,
} from './helpers/workspace-sandbox-matrix';

const AGENT_SETUPS: SandboxAgentSetup[] = [
  {
    testIdBase: 'OPENAI',
    describeAgent: 'OpenCode',
    agent: CODING_AGENT.OPENCODE,
    requiredResource: 'openai',
    workspacePrefix: 'opencode',
    selectModel: async createPage => createPage.searchAndSelectModel(OPENAI_SMOKE_MODEL),
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.OPENCODE,
    promptTest: {
      prompt: 'what is 123+456? reply with just the number',
      expectedResponse: /579|insufficient|balance|credit|quota exceeded/i,
    },
  },
  {
    testIdBase: 'CLAUDE',
    describeAgent: 'Claude Code',
    agent: CODING_AGENT.CLAUDE,
    requiredResource: 'claude',
    workspacePrefix: 'claude',
    selectModel: async (createPage): Promise<string | undefined> => {
      await createPage.verifyModelRuntimes('Claude');
      return createPage.selectDefaultModel();
    },
    terminalReadyPatterns: TERMINAL_READY_PATTERNS.CLAUDE,
    promptTest: {
      prompt: 'what is 2+2? reply with just the number',
      expectedResponse: /4|insufficient|balance|credit/i,
    },
  },
];

const SANDBOX_SCENARIOS: SandboxScenario[] = [
  // --- Core matrix ---
  // Names are `{agent}-{workspaceSlug}`; slug must keep total ≤ 19 chars.
  {
    id: 'FS-NONE-NET-DEVELOPER',
    workspaceSlug: 'none-dev',
    fileAccess: FILE_ACCESS_LEVEL.NO_HOST_ACCESS,
    network: NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET,
  },
  {
    id: 'FS-CUSTOM-NET-DEVELOPER',
    workspaceSlug: 'cust-dev',
    fileAccess: FILE_ACCESS_LEVEL.CUSTOM_PATHS,
    customMounts: CUSTOM_RW_MOUNT,
    network: NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET,
  },
  {
    id: 'FS-NONE-NET-DENY',
    workspaceSlug: 'none-deny',
    fileAccess: FILE_ACCESS_LEVEL.NO_HOST_ACCESS,
    network: NETWORK_ACCESS_LEVEL.DENY_ALL,
  },
  // --- Extended filesystem × network ---
  {
    id: 'FS-CUSTOM-NET-DENY',
    workspaceSlug: 'cust-deny',
    fileAccess: FILE_ACCESS_LEVEL.CUSTOM_PATHS,
    customMounts: CUSTOM_RW_MOUNT,
    network: NETWORK_ACCESS_LEVEL.DENY_ALL,
  },
  {
    id: 'FS-CUSTOM-RO-NET-DEVELOPER',
    workspaceSlug: 'cust-ro',
    fileAccess: FILE_ACCESS_LEVEL.CUSTOM_PATHS,
    customMounts: CUSTOM_RO_MOUNT,
    network: NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET,
  },
  // --- Custom mount edge cases ---
  {
    id: 'FS-CUSTOM-DEFAULT-TARGET-NET-DEVELOPER',
    workspaceSlug: 'cust-def',
    fileAccess: FILE_ACCESS_LEVEL.CUSTOM_PATHS,
    customMounts: CUSTOM_DEFAULT_TARGET_MOUNT,
    network: NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET,
  },
  {
    id: 'FS-CUSTOM-MULTI-NET-DEVELOPER',
    workspaceSlug: 'cust-multi',
    fileAccess: FILE_ACCESS_LEVEL.CUSTOM_PATHS,
    customMounts: CUSTOM_MULTI_MOUNTS,
    network: NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET,
  },
  // --- Network host allowlist edge cases ---
  {
    id: 'FS-NONE-NET-DENY-CUSTOM-HOST',
    workspaceSlug: 'deny-host',
    fileAccess: FILE_ACCESS_LEVEL.NO_HOST_ACCESS,
    network: NETWORK_ACCESS_LEVEL.DENY_ALL,
    denyHosts: [CUSTOM_ALLOWED_HOST],
  },
  {
    id: 'FS-NONE-NET-DEVELOPER-ADDITIONAL-HOST',
    workspaceSlug: 'dev-extra',
    fileAccess: FILE_ACCESS_LEVEL.NO_HOST_ACCESS,
    network: NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET,
    additionalHosts: [CUSTOM_ALLOWED_HOST],
  },
];

registerSandboxMatrixTests(test, expect, AGENT_SETUPS, SANDBOX_SCENARIOS);
