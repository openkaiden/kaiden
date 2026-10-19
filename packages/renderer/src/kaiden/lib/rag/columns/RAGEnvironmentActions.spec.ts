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

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import type { RagEnvironment } from '/@api/rag/rag-environment';

import RAGEnvironmentActions from './RAGEnvironmentActions.svelte';

vi.mock(import('/@/lib/dialogs/messagebox-utils'));

const ragEnvironment: RagEnvironment = {
  name: 'test-env',
  ragConnection: { name: 'test-rag', providerId: 'provider-1' },
  chunkerConnection: { id: 'chunker-1', providerId: 'provider-1' },
  files: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.deleteRagEnvironment).mockResolvedValue(undefined);
});

test('should display delete button', () => {
  render(RAGEnvironmentActions, { object: ragEnvironment });

  expect(screen.getByRole('button', { name: 'Delete environment' })).toBeInTheDocument();
});

test('should call withConfirmation when delete button clicked', async () => {
  render(RAGEnvironmentActions, { object: ragEnvironment });

  const deleteButton = screen.getByRole('button', { name: 'Delete environment' });
  await fireEvent.click(deleteButton);

  expect(withConfirmation).toHaveBeenCalledWith(expect.any(Function), 'delete environment test-env');
});

test('should delete environment when user confirms deletion', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn());

  render(RAGEnvironmentActions, { object: ragEnvironment });

  const deleteButton = screen.getByRole('button', { name: 'Delete environment' });
  await fireEvent.click(deleteButton);

  await vi.waitFor(() => {
    expect(window.deleteRagEnvironment).toHaveBeenCalledWith('test-env');
  });
});

test('should not delete environment when confirmation dialog fails', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn(new Error('dialog error')));

  render(RAGEnvironmentActions, { object: ragEnvironment });

  const deleteButton = screen.getByRole('button', { name: 'Delete environment' });
  await fireEvent.click(deleteButton);

  expect(window.deleteRagEnvironment).not.toHaveBeenCalled();
});

test('should call onDelete callback after successful deletion', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn());
  const onDeleteMock = vi.fn();

  render(RAGEnvironmentActions, { object: ragEnvironment, onDelete: onDeleteMock });

  const deleteButton = screen.getByRole('button', { name: 'Delete environment' });
  await fireEvent.click(deleteButton);

  await vi.waitFor(() => {
    expect(onDeleteMock).toHaveBeenCalledOnce();
  });
});

test('should not call onDelete callback when deletion fails', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn());
  vi.mocked(window.deleteRagEnvironment).mockRejectedValue(new Error('deletion failed'));
  const onDeleteMock = vi.fn();

  render(RAGEnvironmentActions, { object: ragEnvironment, onDelete: onDeleteMock });

  const deleteButton = screen.getByRole('button', { name: 'Delete environment' });
  await fireEvent.click(deleteButton);

  await vi.waitFor(() => {
    expect(window.deleteRagEnvironment).toHaveBeenCalledWith('test-env');
  });

  expect(onDeleteMock).not.toHaveBeenCalled();
});

test('should not call onDelete when no callback is provided', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn());

  render(RAGEnvironmentActions, { object: ragEnvironment });

  const deleteButton = screen.getByRole('button', { name: 'Delete environment' });
  await fireEvent.click(deleteButton);

  await vi.waitFor(() => {
    expect(window.deleteRagEnvironment).toHaveBeenCalledWith('test-env');
  });
});
