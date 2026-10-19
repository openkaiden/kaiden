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

import AgentWorkspaceCreateStepWorkspace from './AgentWorkspaceCreateStepWorkspace.svelte';

const defaultProps = {
  sourcePath: '',
  sessionName: '',
  description: '',
  nameManuallyEdited: false,
  descriptionOpen: false,
  projectOpen: false,
  onBrowseSource: vi.fn(),
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('Expect step heading is displayed', () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  expect(screen.getByText('Workspace')).toBeInTheDocument();
});

test('Expect step description is displayed', () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  expect(screen.getByText(/Point to a local project folder/)).toBeInTheDocument();
});

test('Expect project folder label and input are rendered', () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  expect(screen.getByText(/Project folder/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('/path/to/project')).toBeInTheDocument();
});

test('Expect workspace name input is rendered', () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  expect(screen.getByPlaceholderText('e.g., front-refactor')).toBeInTheDocument();
});

test('Expect description section is collapsed by default', () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  expect(
    screen.queryByPlaceholderText(
      'e.g. Debug the login timeout — reproduce issue #42 and propose a fix (optional, max 500 chars)',
    ),
  ).not.toBeInTheDocument();
});

test('Expect description section expands when toggle is clicked', async () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  await fireEvent.click(screen.getByRole('button', { name: /Description/ }));

  expect(
    screen.getByPlaceholderText(
      'e.g. Debug the login timeout — reproduce issue #42 and propose a fix (optional, max 500 chars)',
    ),
  ).toBeInTheDocument();
});

test('Expect description textarea is shown when descriptionOpen is true', () => {
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, descriptionOpen: true });

  expect(
    screen.getByPlaceholderText(
      'e.g. Debug the login timeout — reproduce issue #42 and propose a fix (optional, max 500 chars)',
    ),
  ).toBeInTheDocument();
});

test('Expect description field has maxlength and shows character counter', async () => {
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, descriptionOpen: true, description: 'Hello world' });

  const textarea = screen.getByRole('textbox', { name: 'Description' });
  expect(textarea).toHaveAttribute('maxlength', '500');
  expect(textarea).toHaveValue('Hello world');
  expect(screen.getByText('11/500')).toBeInTheDocument();
});

test('Expect description hides character counter when empty', () => {
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, descriptionOpen: true, description: '' });

  expect(screen.queryByText(/\/500/)).not.toBeInTheDocument();
});

test('Expect browse button calls onBrowseSource', async () => {
  const onBrowseSource = vi.fn();
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, onBrowseSource });

  await fireEvent.click(screen.getByRole('button', { name: 'Browse for folder' }));

  expect(onBrowseSource).toHaveBeenCalledOnce();
});

test('Expect source input renders initial value', () => {
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, sourcePath: '/home/user/project' });

  expect((screen.getByPlaceholderText('/path/to/project') as HTMLInputElement).value).toBe('/home/user/project');
});

test('Expect workspace name input renders initial value', () => {
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, sessionName: 'my-workspace' });

  expect((screen.getByPlaceholderText('e.g., front-refactor') as HTMLInputElement).value).toBe('my-workspace');
});

test('shows validation error when workspace name exceeds hostname limit', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: 'a'.repeat(20),
  });

  expect(screen.getByText(/must not exceed 19 characters/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('e.g., front-refactor')).toHaveAttribute('aria-invalid', 'true');
});

test('shows validation error when basename-derived name exceeds hostname limit', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sourcePath: `/home/user/${'a'.repeat(20)}`,
    sessionName: '',
  });

  expect(screen.getByText(/must not exceed 19 characters/)).toBeInTheDocument();
});

test('accepts workspace name at exactly the hostname limit', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: 'a'.repeat(19),
  });

  expect(screen.queryByText(/must not exceed 19 characters/)).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('e.g., front-refactor')).toHaveAttribute('aria-invalid', 'false');
});

test('shows validation error when workspace name contains uppercase letters', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: 'MyWorkspace',
  });

  expect(screen.getByText(/must contain only lowercase letters/)).toBeInTheDocument();
  expect(screen.getByPlaceholderText('e.g., front-refactor')).toHaveAttribute('aria-invalid', 'true');
});

test('shows validation error when workspace name contains spaces', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: 'my workspace',
  });

  expect(screen.getByText(/must contain only lowercase letters/)).toBeInTheDocument();
});

test('shows validation error when workspace name has leading hyphen', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: '-workspace',
  });

  expect(screen.getByText(/must not start or end with a hyphen/)).toBeInTheDocument();
});

test('shows validation error when workspace name has trailing hyphen', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: 'workspace-',
  });

  expect(screen.getByText(/must not start or end with a hyphen/)).toBeInTheDocument();
});

test('shows validation error when workspace name has consecutive hyphens', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    sessionName: 'my--workspace',
  });

  expect(screen.getByText(/must not contain consecutive hyphens/)).toBeInTheDocument();
});

test('shows config-exists notification when configExists is true', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    configExists: true,
    onStartAsIs: vi.fn(),
  });

  expect(screen.getByText(/existing workspace configuration was found/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeInTheDocument();
});

test('hides config-exists notification when configExists is false', () => {
  render(AgentWorkspaceCreateStepWorkspace, defaultProps);

  expect(screen.queryByText(/existing workspace configuration was found/)).not.toBeInTheDocument();
});

test('calls onStartAsIs when Start workspace as-is button is clicked', async () => {
  const onStartAsIs = vi.fn();
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    configExists: true,
    onStartAsIs,
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Start workspace as-is' }));

  expect(onStartAsIs).toHaveBeenCalledOnce();
});

test('shows merge/replace radio buttons when configExists is true', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    configExists: true,
    configAction: 'merge',
  });

  expect(screen.getByLabelText('Merge with existing')).toBeInTheDocument();
  expect(screen.getByLabelText('Replace existing')).toBeInTheDocument();
});

test('selects replace radio when clicked', async () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    configExists: true,
    configAction: 'merge',
  });

  await fireEvent.click(screen.getByLabelText('Replace existing'));

  expect(screen.getByLabelText('Replace existing')).toBeChecked();
});

test('shows name error when errors.name is set', () => {
  render(AgentWorkspaceCreateStepWorkspace, {
    ...defaultProps,
    errors: { name: 'A workspace with this name already exists. Please choose a different name.' },
  });

  expect(screen.getByText(/workspace with this name already exists/)).toBeInTheDocument();
});

test('hides name error when errors is empty', () => {
  render(AgentWorkspaceCreateStepWorkspace, { ...defaultProps, errors: {} });

  expect(screen.queryByText(/workspace with this name already exists/)).not.toBeInTheDocument();
});
