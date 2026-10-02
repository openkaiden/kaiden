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

import { assert, beforeEach, describe, expect, test } from 'vitest';

import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { ragEnvironments } from '/@/stores/rag-environments';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { skillInfos } from '/@/stores/skills';
import type { NetworkConfiguration } from '/@api/agent-workspace-info';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { ModelInfo } from '/@api/model-registry-info';
import type { RagEnvironment } from '/@api/rag/rag-environment';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import {
  applyProjectToDraft,
  initializeDraftFromProject,
  resetDraft,
  wizard,
  WORKSPACE_REGISTRY_HOSTS,
} from './agent-workspace-create-draft.svelte';

let project: WorkspaceProjectInfo;

beforeEach(() => {
  project = {
    id: 'project',
    name: 'My Project',
    folder: '/projects/app',
    skills: ['skill'],
    mcpServers: ['mcp'],
    secrets: ['secret'],
    knowledges: ['knowledge'],
    filesystem: { mode: 'custom', mounts: [{ host: '/data', target: '/data', ro: true }] },
    network: { mode: 'deny', hosts: ['example.com'] },
  };
  skillInfos.set([]);
  mcpRemoteServerInfos.set([]);
  secretVaultInfos.set([]);
  ragEnvironments.set([]);
  resetDraft();
});

describe('wizard.draft initial state', () => {
  test('should start with step index 0', () => {
    expect(wizard.draft.currentStepIndex).toBe(0);
  });

  test('should start with empty form fields', () => {
    expect(wizard.draft.sourcePath).toBe('');
    expect(wizard.draft.sessionName).toBe('');
    expect(wizard.draft.description).toBe('');
  });

  test('should start with default agent opencode', () => {
    expect(wizard.draft.selectedAgent).toBe('opencode');
  });

  test('should start with no model selected', () => {
    expect(wizard.draft.selectedModel).toBeUndefined();
  });

  test('should start with workspace file access', () => {
    expect(wizard.draft.selectedFileAccess).toBe('workspace');
  });

  test('should start with registries network', () => {
    expect(wizard.draft.selectedNetwork).toBe('registries');
  });

  test('should start with empty selection arrays', () => {
    expect(wizard.draft.selectedSkillIds).toEqual([]);
    expect(wizard.draft.selectedMcpIds).toEqual([]);
    expect(wizard.draft.selectedSecretIds).toEqual([]);
    expect(wizard.draft.selectedKnowledgeIds).toEqual([]);
  });

  test('should start uninitialized', () => {
    expect(wizard.draft.initialized).toBe(false);
  });

  test('should start with default hostsByMode', () => {
    expect(wizard.draft.hostsByMode).toEqual({
      registries: WORKSPACE_REGISTRY_HOSTS,
      blocked: [''],
    });
  });
});

describe('applyProjectToDraft', () => {
  test('copies project configuration without overwriting runtime selections', () => {
    const model: ModelInfo = {
      providerId: 'provider',
      connectionId: 'connection',
      connectionName: 'My connection',
      type: 'cloud',
      label: 'My model',
    };
    wizard.draft.selectedModel = model;
    wizard.draft.customImage = 'custom:image';
    wizard.draft.currentStepIndex = 3;
    wizard.draft.initialized = true;
    wizard.draft.selectedAgent = 'claude';
    wizard.draft.selectedGateway = 'gateway';
    wizard.draft.description = 'Keep description';
    applyProjectToDraft(project);

    expect(wizard.draft).toMatchObject({
      selectedProjectId: project.id,
      sourcePath: project.folder,
      sessionName: 'my-project',
      nameManuallyEdited: true,
      selectedSkillIds: ['skill'],
      selectedMcpIds: ['mcp'],
      selectedSecretIds: ['secret'],
      selectedKnowledgeIds: ['knowledge'],
      selectedFileAccess: 'custom',
      customMounts: project.filesystem.mounts,
      selectedNetwork: 'blocked',
      hostsByMode: { blocked: ['example.com'] },
      selectedAgent: 'claude',
      selectedGateway: 'gateway',
      description: 'Keep description',
      selectedModel: model,
      customImage: 'custom:image',
      currentStepIndex: 3,
      initialized: true,
      projectOpen: false,
    });
    wizard.draft.selectedSkillIds.push('another');
    const mount = wizard.draft.customMounts[0];
    assert(mount);
    mount.host = '/changed';
    expect(project.skills).toEqual(['skill']);
    expect(project.filesystem.mounts).toEqual([{ host: '/data', target: '/data', ro: true }]);
  });

  test('project without mounts restores workspace-only file access', () => {
    wizard.draft.selectedFileAccess = 'custom';
    wizard.draft.customMounts = [{ host: '/old', target: '/old', ro: true }];
    applyProjectToDraft({ ...project, filesystem: { mode: 'project', mounts: [] } });
    expect(wizard.draft.selectedFileAccess).toBe('workspace');
    expect(wizard.draft.customMounts).toEqual([{ host: '', target: '', ro: false }]);
  });

  test.each([false, true])('project mount is writable with ro omitted: %s', omitReadOnly => {
    const mount = { host: '/data', target: '/data', ro: false };
    if (omitReadOnly) Reflect.deleteProperty(mount, 'ro');
    applyProjectToDraft({
      ...project,
      filesystem: { mode: 'custom', mounts: [mount] },
    });
    expect(wizard.draft.customMounts).toEqual([{ host: '/data', target: '/data', ro: false }]);
  });

  test.each<[NetworkConfiguration, string, string[]]>([
    [{ mode: 'allow' }, 'registries', WORKSPACE_REGISTRY_HOSTS],
    [{ mode: 'deny', hosts: [...WORKSPACE_REGISTRY_HOSTS] }, 'registries', WORKSPACE_REGISTRY_HOSTS],
    [{ mode: 'deny' }, 'blocked', ['']],
  ])('project network %j maps to workspace controls', (network, mode, hosts) => {
    applyProjectToDraft({ ...project, network });
    expect(wizard.draft.selectedNetwork).toBe(mode);
    expect(wizard.draft.hostsByMode[mode]).toEqual(hosts);
  });
});

test('initializeDraftFromProject replaces project settings but preserves workspace-only choices', () => {
  wizard.draft.currentStepIndex = 4;
  wizard.draft.initialized = true;
  wizard.draft.description = 'My workspace';
  wizard.draft.selectedAgent = 'claude';
  wizard.draft.selectedGateway = 'my-gateway';
  wizard.draft.customImage = 'my-image:latest';
  wizard.draft.selectedMcpIds = ['old-mcp'];
  const model: ModelInfo = {
    providerId: 'provider',
    connectionId: 'connection',
    connectionName: 'My connection',
    type: 'cloud',
    label: 'My model',
  };
  wizard.draft.selectedModel = model;
  initializeDraftFromProject({ ...project, filesystem: { mode: 'project', mounts: [] } });
  expect(wizard.draft).toMatchObject({
    currentStepIndex: 0,
    initialized: true,
    description: 'My workspace',
    selectedAgent: 'claude',
    selectedGateway: 'my-gateway',
    customImage: 'my-image:latest',
    selectedMcpIds: project.mcpServers,
    selectedProjectId: project.id,
    projectOpen: true,
    selectedFileAccess: 'workspace',
    customMounts: [{ host: '', target: '', ro: false }],
  });
  expect(wizard.draft.selectedModel).toEqual(model);
});

test('initializeDraftFromProject leaves a new draft ready for normal runtime initialization', () => {
  initializeDraftFromProject(project);
  expect(wizard.draft.initialized).toBe(false);
});

describe('resetDraft', () => {
  test('should reset all fields to defaults', () => {
    wizard.draft.currentStepIndex = 3;
    wizard.draft.sourcePath = '/some/path';
    wizard.draft.sessionName = 'my-session';
    wizard.draft.selectedAgent = 'claude';
    wizard.draft.initialized = true;
    wizard.draft.selectedSkillIds = ['skill-1', 'skill-2'];

    resetDraft();

    expect(wizard.draft.currentStepIndex).toBe(0);
    expect(wizard.draft.sourcePath).toBe('');
    expect(wizard.draft.sessionName).toBe('');
    expect(wizard.draft.selectedAgent).toBe('opencode');
    expect(wizard.draft.initialized).toBe(false);
    expect(wizard.draft.selectedSkillIds).toEqual([]);
  });
});

describe('state persistence', () => {
  test('should retain values between accesses', () => {
    wizard.draft.sourcePath = '/home/user/project';
    wizard.draft.currentStepIndex = 2;
    wizard.draft.selectedSkillIds = ['k8s', 'docker'];

    expect(wizard.draft.sourcePath).toBe('/home/user/project');
    expect(wizard.draft.currentStepIndex).toBe(2);
    expect(wizard.draft.selectedSkillIds).toEqual(['k8s', 'docker']);
  });
});

describe('resetDraft selects all available items', () => {
  test('should select all enabled skills', () => {
    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);
    resetDraft();

    expect(wizard.draft.selectedSkillIds).toEqual(['k8s', 'docker']);
  });

  test('should exclude disabled skills', () => {
    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: false, managed: false },
    ]);
    resetDraft();

    expect(wizard.draft.selectedSkillIds).toEqual(['k8s']);
  });

  test('should select all MCP servers', () => {
    mcpRemoteServerInfos.set([{ id: 'srv-1', name: 'Server 1' } as MCPRemoteServerInfo]);
    resetDraft();

    expect(wizard.draft.selectedMcpIds).toEqual(['srv-1']);
  });

  test('should not select any secrets', () => {
    secretVaultInfos.set([{ id: 'sec-1', name: 'Secret 1', type: 'api', description: '' } as SecretVaultInfo]);
    resetDraft();

    expect(wizard.draft.selectedSecretIds).toEqual([]);
  });

  test('should select knowledge bases with mcpServer only', () => {
    ragEnvironments.set([
      { name: 'with-mcp', mcpServer: { id: 'mcp-1' } } as unknown as RagEnvironment,
      { name: 'without-mcp', mcpServer: undefined } as unknown as RagEnvironment,
    ]);
    resetDraft();

    expect(wizard.draft.selectedKnowledgeIds).toEqual(['with-mcp']);
  });
});

describe('first emission seeding', () => {
  test('should seed selections from pre-populated stores on first emission after reset', () => {
    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);
    mcpRemoteServerInfos.set([{ id: 'srv-1', name: 'Server 1' } as MCPRemoteServerInfo]);
    secretVaultInfos.set([{ id: 'sec-1', name: 'Secret 1', type: 'api', description: '' } as SecretVaultInfo]);
    ragEnvironments.set([{ name: 'kb-1', mcpServer: { id: 'mcp-1' } } as unknown as RagEnvironment]);

    expect(wizard.draft.selectedSkillIds).toContain('k8s');
    expect(wizard.draft.selectedSkillIds).toContain('docker');
    expect(wizard.draft.selectedMcpIds).toContain('srv-1');
    expect(wizard.draft.selectedSecretIds).toEqual([]);
    expect(wizard.draft.selectedKnowledgeIds).toContain('kb-1');
  });
});

describe('selection syncing from subscriptions', () => {
  test('should remove skills no longer available', () => {
    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);
    resetDraft();

    skillInfos.set([{ name: 'k8s', description: '', path: '', enabled: true, managed: false }]);

    expect(wizard.draft.selectedSkillIds).toEqual(['k8s']);
  });

  test('should preserve user deselections when store re-emits', () => {
    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);
    resetDraft();

    wizard.draft.selectedSkillIds = ['k8s'];

    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);

    expect(wizard.draft.selectedSkillIds).toEqual(['k8s']);
  });

  test('should auto-select newly added items', () => {
    skillInfos.set([{ name: 'k8s', description: '', path: '', enabled: true, managed: false }]);
    resetDraft();

    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);

    expect(wizard.draft.selectedSkillIds).toEqual(['k8s', 'docker']);
  });

  test('should remove skill when it becomes disabled', () => {
    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: true, managed: false },
    ]);
    resetDraft();

    skillInfos.set([
      { name: 'k8s', description: '', path: '', enabled: true, managed: false },
      { name: 'docker', description: '', path: '', enabled: false, managed: false },
    ]);

    expect(wizard.draft.selectedSkillIds).toEqual(['k8s']);
  });
});
