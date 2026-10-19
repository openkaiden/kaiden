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
import { router } from 'tinro';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { SandboxInfo } from '/@api/openshell-gateway-info';

import SandboxName from './SandboxName.svelte';

vi.mock(import('tinro'));

const mockSandbox: SandboxInfo = {
  id: 'sandbox-123',
  name: 'my-workspace',
  phase: 'Ready',
  created_at: '2026-06-25T10:00:00Z',
  sourcePath: '/home/user/projects/backend',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

test('Expect sandbox name is displayed', () => {
  render(SandboxName, { object: mockSandbox });

  expect(screen.getByText('my-workspace')).toBeInTheDocument();
});

test('Expect sandbox ID is displayed', () => {
  render(SandboxName, { object: mockSandbox });

  expect(screen.getByText('ID: sandbox-123')).toBeInTheDocument();
});

test('Expect tooltip wrapper is present with sourcePath', () => {
  render(SandboxName, { object: mockSandbox });

  // Verify the tooltip wrapper exists
  const tooltipTrigger = screen.getByTestId('tooltip-trigger');
  expect(tooltipTrigger).toBeInTheDocument();
});

test('Expect tooltip wrapper is present when sourcePath is undefined', () => {
  const sandboxWithoutPath: SandboxInfo = {
    ...mockSandbox,
    sourcePath: undefined,
  };

  render(SandboxName, { object: sandboxWithoutPath });

  // Verify the tooltip wrapper exists
  const tooltipTrigger = screen.getByTestId('tooltip-trigger');
  expect(tooltipTrigger).toBeInTheDocument();
});

test('Expect clicking navigates to workspace overview page', async () => {
  render(SandboxName, { object: mockSandbox });

  const button = screen.getByRole('button');
  await fireEvent.click(button);

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/sandbox-123/overview');
});

test('Expect navigation URL encodes sandbox ID', async () => {
  const sandboxWithSpecialId: SandboxInfo = {
    ...mockSandbox,
    id: 'sandbox/with/slashes',
  };

  render(SandboxName, { object: sandboxWithSpecialId });

  const button = screen.getByRole('button');
  await fireEvent.click(button);

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/sandbox%2Fwith%2Fslashes/overview');
});

test('Expect name is displayed with proper styling', () => {
  render(SandboxName, { object: mockSandbox });

  const nameElement = screen.getByText('my-workspace');
  expect(nameElement).toHaveClass('text-sm');
  expect(nameElement).toHaveClass('text-[var(--pd-table-body-text)]');
});

test('Expect ID is displayed with proper styling', () => {
  render(SandboxName, { object: mockSandbox });

  const idElement = screen.getByText('ID: sandbox-123');
  expect(idElement).toHaveClass('text-xs');
  expect(idElement).toHaveClass('text-[var(--pd-table-body-text-sub)]');
});

test('Expect component renders with long sandbox name', () => {
  const sandboxWithLongName: SandboxInfo = {
    ...mockSandbox,
    name: 'very-long-workspace-name-that-might-overflow-the-container-area',
  };

  render(SandboxName, { object: sandboxWithLongName });

  expect(screen.getByText('very-long-workspace-name-that-might-overflow-the-container-area')).toBeInTheDocument();
});

test('Expect component renders with long ID', () => {
  const sandboxWithLongId: SandboxInfo = {
    ...mockSandbox,
    id: 'very-long-sandbox-id-with-many-characters-and-hyphens-12345678',
  };

  render(SandboxName, { object: sandboxWithLongId });

  expect(screen.getByText('ID: very-long-sandbox-id-with-many-characters-and-hyphens-12345678')).toBeInTheDocument();
});

test('Expect component renders with long sourcePath', () => {
  const sandboxWithLongPath: SandboxInfo = {
    ...mockSandbox,
    sourcePath: '/home/user/very/deep/nested/directory/structure/projects/backend/src/main',
  };

  render(SandboxName, { object: sandboxWithLongPath });

  // Verify the component renders without error with long path
  expect(screen.getByText('my-workspace')).toBeInTheDocument();
  expect(screen.getByTestId('tooltip-trigger')).toBeInTheDocument();
});

test('Expect component handles different sandbox phases', () => {
  const phases: Array<SandboxInfo['phase']> = ['Provisioning', 'Ready', 'Error', 'Deleting', 'Unknown', 'Unspecified'];

  for (const phase of phases) {
    const { unmount } = render(SandboxName, { object: { ...mockSandbox, phase } });
    expect(screen.getByText('my-workspace')).toBeInTheDocument();
    unmount();
  }
});

test('Expect button is clickable and accessible', () => {
  render(SandboxName, { object: mockSandbox });

  const button = screen.getByRole('button');
  expect(button).toBeInTheDocument();
  expect(button).toHaveClass('flex', 'items-start');
});

test('Expect button is disabled when sandbox is Deleting', () => {
  render(SandboxName, { object: { ...mockSandbox, phase: 'Deleting' } });

  const button = screen.getByRole('button');
  expect(button).toBeDisabled();
});

test('Expect clicking does not navigate when sandbox is Deleting', async () => {
  render(SandboxName, { object: { ...mockSandbox, phase: 'Deleting' } });

  const button = screen.getByRole('button');
  await fireEvent.click(button);

  expect(router.goto).not.toHaveBeenCalled();
});
