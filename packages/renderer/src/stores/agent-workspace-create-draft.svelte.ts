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

import { get } from 'svelte/store';

import type { CustomMount } from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepFileSystem.svelte';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { ragEnvironments } from '/@/stores/rag-environments';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { skillInfos } from '/@/stores/skills';
import { type NetworkConfiguration, sanitizeDns1123Label } from '/@api/agent-workspace-info';
import type { ModelInfo } from '/@api/model-registry-info';
import type { FilesystemConfiguration, WorkspaceProjectInfo } from '/@api/workspace-project-info';

export const WORKSPACE_REGISTRY_HOSTS = ['registry.npmjs.org', 'pypi.python.org'];

interface WorkspaceCreateDraft {
  currentStepIndex: number;
  selectedProjectId: string | undefined;
  selectedGateway: string;
  sourcePath: string;
  sessionName: string;
  description: string;
  configExists: boolean;
  configAction: 'merge' | 'replace';
  selectedAgent: string;
  selectedModel: ModelInfo | undefined;
  selectedFileAccess: string;
  selectedNetwork: string;
  customMounts: CustomMount[];
  hostsByMode: Record<string, string[]>;
  nameManuallyEdited: boolean;
  descriptionOpen: boolean;
  projectOpen: boolean;
  selectedSkillIds: string[];
  selectedMcpIds: string[];
  selectedSecretIds: string[];
  selectedKnowledgeIds: string[];
  customImage: string;
  customImageFieldOpen: boolean;
  initialized: boolean;
}

function createInitialDraft(): WorkspaceCreateDraft {
  return {
    currentStepIndex: 0,
    selectedProjectId: undefined,
    selectedGateway: '',
    sourcePath: '',
    sessionName: '',
    description: '',
    configExists: false,
    configAction: 'merge',
    selectedAgent: 'opencode',
    selectedModel: undefined,
    selectedFileAccess: 'workspace',
    selectedNetwork: 'registries',
    customMounts: [{ host: '', target: '', ro: false }],
    hostsByMode: {
      registries: [...WORKSPACE_REGISTRY_HOSTS],
      blocked: [''],
    },
    nameManuallyEdited: false,
    descriptionOpen: false,
    projectOpen: false,
    selectedSkillIds: [],
    selectedMcpIds: [],
    selectedSecretIds: [],
    selectedKnowledgeIds: [],
    customImage: '',
    customImageFieldOpen: false,
    initialized: false,
  };
}

export const wizard = $state<{ draft: WorkspaceCreateDraft }>({ draft: createInitialDraft() });

export function resetDraft(): void {
  wizard.draft = createInitialDraft();
  wizard.draft.selectedSkillIds = get(skillInfos)
    .filter(s => s.enabled)
    .map(s => s.name);
  wizard.draft.selectedMcpIds = get(mcpRemoteServerInfos).map(m => m.id);
  wizard.draft.selectedKnowledgeIds = get(ragEnvironments)
    .filter(r => r.mcpServer)
    .map(r => r.name);
}

function applyFilesystemFromProject(fs: FilesystemConfiguration): void {
  const hasMounts = fs.mounts.length > 0;
  if (!hasMounts) {
    wizard.draft.selectedFileAccess = 'workspace';
    wizard.draft.customMounts = [{ host: '', target: '', ro: false }];
    return;
  }
  wizard.draft.selectedFileAccess = 'custom';
  wizard.draft.customMounts = fs.mounts.map(m => ({ host: m.host, target: m.target, ro: m.ro ?? false }));
}

function isRegistryPreset(hosts: string[]): boolean {
  return hosts.length === WORKSPACE_REGISTRY_HOSTS.length && hosts.every((h, i) => h === WORKSPACE_REGISTRY_HOSTS[i]);
}

function applyNetworkFromProject(net: NetworkConfiguration | undefined): void {
  if (!net) return;
  // mode: allow is no longer offered in the UI; fall back to the recommended preset.
  if (net.mode === 'allow') {
    wizard.draft.selectedNetwork = 'registries';
    wizard.draft.hostsByMode = {
      ...wizard.draft.hostsByMode,
      registries: [...WORKSPACE_REGISTRY_HOSTS],
    };
    return;
  }
  const hosts = net.hosts ?? [];
  if (hosts.length > 0 && isRegistryPreset(hosts)) {
    wizard.draft.selectedNetwork = 'registries';
    wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, registries: [...hosts] };
  } else if (hosts.length > 0) {
    wizard.draft.selectedNetwork = 'blocked';
    wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, blocked: [...hosts] };
  } else {
    wizard.draft.selectedNetwork = 'blocked';
    wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, blocked: [''] };
  }
}

export function applyProjectToDraft(project: WorkspaceProjectInfo): void {
  wizard.draft.selectedProjectId = project.id;
  wizard.draft.sourcePath = project.folder;
  wizard.draft.sessionName = sanitizeDns1123Label(project.name);
  wizard.draft.nameManuallyEdited = true;
  wizard.draft.selectedSkillIds = [...project.skills];
  wizard.draft.selectedMcpIds = [...project.mcpServers];
  wizard.draft.selectedSecretIds = [...project.secrets];
  wizard.draft.selectedKnowledgeIds = [...project.knowledges];
  applyFilesystemFromProject(project.filesystem);
  applyNetworkFromProject(project.network);
}

/** Opens the project in the wizard while preserving workspace-only choices in the existing draft. */
export function initializeDraftFromProject(project: WorkspaceProjectInfo): void {
  applyProjectToDraft(project);
  wizard.draft.currentStepIndex = 0;
  wizard.draft.projectOpen = true;
}

let prevSkills: Set<string> | undefined;
skillInfos.subscribe(skills => {
  const available = new Set(skills.filter(s => s.enabled).map(s => s.name));
  const added = prevSkills ? [...available].filter(id => !prevSkills!.has(id)) : [...available];
  wizard.draft.selectedSkillIds = [...wizard.draft.selectedSkillIds.filter(id => available.has(id)), ...added];
  prevSkills = available;
});

let prevMcp: Set<string> | undefined;
mcpRemoteServerInfos.subscribe(servers => {
  const available = new Set(servers.map(m => m.id));
  const added = prevMcp ? [...available].filter(id => !prevMcp!.has(id)) : [...available];
  wizard.draft.selectedMcpIds = [...wizard.draft.selectedMcpIds.filter(id => available.has(id)), ...added];
  prevMcp = available;
});

secretVaultInfos.subscribe(secrets => {
  const available = new Set(secrets.map(s => s.id));
  wizard.draft.selectedSecretIds = wizard.draft.selectedSecretIds.filter(id => available.has(id));
});

let prevKnowledge: Set<string> | undefined;
ragEnvironments.subscribe(envs => {
  const available = new Set(envs.filter(r => r.mcpServer).map(r => r.name));
  const added = prevKnowledge ? [...available].filter(id => !prevKnowledge!.has(id)) : [...available];
  wizard.draft.selectedKnowledgeIds = [...wizard.draft.selectedKnowledgeIds.filter(id => available.has(id)), ...added];
  prevKnowledge = available;
});

// re-running guided setup can change the default agent/model; invalidate so a live draft picks up the new defaults on next mount
window.events?.receive('onboarding:restart', () => {
  wizard.draft.initialized = false;
});
