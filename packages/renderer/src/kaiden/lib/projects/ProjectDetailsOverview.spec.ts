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

import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import { mcpRemoteServerInfos } from '/@/kaiden/stores/mcp-remote-servers';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import ProjectDetailsOverview from './ProjectDetailsOverview.svelte';

const sampleProject: WorkspaceProjectInfo = {
  id: 'my-project',
  name: 'My Project',
  folder: '/home/user/project',
  skills: ['code-review', 'testing'],
  mcpServers: ['mcp-server-1'],
  knowledges: ['knowledge-base-1'],
  secrets: ['api-key'],
  filesystem: { mode: 'allow', mounts: [{ host: '/data', target: '/mnt/data', ro: true }] },
  network: { mode: 'deny' },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  mcpRemoteServerInfos.set([{ id: 'mcp-server-1', name: 'My MCP Server' } as MCPRemoteServerInfo]);
});

test('Expect project name is displayed in info card', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('My Project')).toBeInTheDocument();
});

test('Expect folder path is displayed', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('/home/user/project')).toBeInTheDocument();
});

test('Expect skills are listed in skills card', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('code-review')).toBeInTheDocument();
  expect(screen.getByText('testing')).toBeInTheDocument();
});

test('Expect MCP servers are listed by name', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('My MCP Server')).toBeInTheDocument();
});

test('Expect MCP server falls back to id when name is not found', () => {
  mcpRemoteServerInfos.set([]);
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('mcp-server-1')).toBeInTheDocument();
});

test('Expect knowledge bases are listed', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('knowledge-base-1')).toBeInTheDocument();
});

test('Expect secrets are listed', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('api-key')).toBeInTheDocument();
});

test('Expect filesystem mount target is displayed', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  expect(screen.getByText('/mnt/data')).toBeInTheDocument();
  expect(screen.getByText('read-only')).toBeInTheDocument();
});

test('Expect network label is Deny All when mode is deny', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  const networkCard = screen.getByLabelText('Network card');
  expect(networkCard).toHaveTextContent('Deny All');
});

test('Expect network label is Unrestricted when mode is allow', () => {
  render(ProjectDetailsOverview, { project: { ...sampleProject, network: { mode: 'allow' } } });

  const networkCard = screen.getByLabelText('Network card');
  expect(networkCard).toHaveTextContent('Unrestricted');
});

test('Expect no skills message when skills array is empty', () => {
  render(ProjectDetailsOverview, { project: { ...sampleProject, skills: [] } });

  expect(screen.getByText('No skills configured')).toBeInTheDocument();
});

test('Expect no MCP servers message when array is empty', () => {
  render(ProjectDetailsOverview, { project: { ...sampleProject, mcpServers: [] } });

  expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
});

test('Expect no knowledge message when array is empty', () => {
  render(ProjectDetailsOverview, { project: { ...sampleProject, knowledges: [] } });

  expect(screen.getByText('No knowledge bases configured')).toBeInTheDocument();
});

test('Expect no secrets message when array is empty', () => {
  render(ProjectDetailsOverview, { project: { ...sampleProject, secrets: [] } });

  expect(screen.getByText('No secrets configured')).toBeInTheDocument();
});

test('Expect filesystem badge shows Custom when custom mounts exist', () => {
  render(ProjectDetailsOverview, { project: sampleProject });

  const fsCard = screen.getByLabelText('Filesystem card');
  expect(fsCard).toHaveTextContent('Custom');
});

test('Expect filesystem badge shows Strict when no mounts', () => {
  render(ProjectDetailsOverview, { project: { ...sampleProject, filesystem: { mode: 'allow', mounts: [] } } });

  const fsCard = screen.getByLabelText('Filesystem card');
  expect(fsCard).toHaveTextContent('Strict');
});
