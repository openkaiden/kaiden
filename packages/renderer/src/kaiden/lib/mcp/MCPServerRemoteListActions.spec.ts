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

import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

import MCPServerRemoteListActions from './MCPServerRemoteListActions.svelte';

const packageServer: MCPRemoteServerInfo = {
  id: 'internal:test:package:0',
  infos: { internalProviderId: 'internal', serverId: 'test', remoteId: 0 },
  name: 'Test MCP',
  description: 'A test server',
  url: '',
  setupType: 'package',
  commandSpec: { command: 'node', args: ['server.js'] },
  tools: {},
  status: 'registered',
};

const remoteServer: MCPRemoteServerInfo = {
  ...packageServer,
  setupType: 'remote',
  url: 'https://example.com',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('start button is rendered for registered package server', () => {
  render(MCPServerRemoteListActions, { object: packageServer });

  expect(screen.getByRole('button', { name: 'Start MCP server' })).toBeInTheDocument();
});

test('stop button is rendered for spawned package server', () => {
  render(MCPServerRemoteListActions, { object: { ...packageServer, status: undefined } });

  expect(screen.getByRole('button', { name: 'Stop MCP server' })).toBeInTheDocument();
});

test('start/stop button is not rendered for remote server', () => {
  render(MCPServerRemoteListActions, { object: remoteServer });

  expect(screen.queryByRole('button', { name: 'Start MCP server' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop MCP server' })).not.toBeInTheDocument();
});

test('clicking start calls startMcpServer', async () => {
  render(MCPServerRemoteListActions, { object: packageServer });

  const startButton = screen.getByRole('button', { name: 'Start MCP server' });
  await fireEvent.click(startButton);

  expect(window.startMcpServer).toHaveBeenCalledWith('internal:test:package:0');
});

test('clicking stop calls stopMcpServer', async () => {
  render(MCPServerRemoteListActions, { object: { ...packageServer, status: undefined } });

  const stopButton = screen.getByRole('button', { name: 'Stop MCP server' });
  await fireEvent.click(stopButton);

  expect(window.stopMcpServer).toHaveBeenCalledWith('internal:test:package:0');
});

test('error dialog shown when start fails', async () => {
  vi.mocked(window.startMcpServer).mockRejectedValue(new Error('no kubeconfig provided'));

  render(MCPServerRemoteListActions, { object: packageServer });

  const startButton = screen.getByRole('button', { name: 'Start MCP server' });
  await fireEvent.click(startButton);

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'MCP Server',
        type: 'error',
        message: expect.stringContaining('no kubeconfig provided'),
      }),
    );
  });
});

test('remove button is always rendered', () => {
  render(MCPServerRemoteListActions, { object: packageServer });

  expect(screen.getByRole('button', { name: 'Remove instance of MCP' })).toBeInTheDocument();
});
