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
import { expect, test, vi } from 'vitest';

import AcpAtMentionCompletion from './AcpAtMentionCompletion.svelte';

test('renders attach file option', () => {
  render(AcpAtMentionCompletion, { query: '', onselect: vi.fn(), oncancel: vi.fn() });

  expect(screen.getByText('Attach file…')).toBeInTheDocument();
});

test('hides when query contains whitespace', () => {
  render(AcpAtMentionCompletion, { query: 'some file', onselect: vi.fn(), oncancel: vi.fn() });

  expect(screen.queryByText('Attach file…')).not.toBeInTheDocument();
});

test('handleKey returns true for Enter', () => {
  const onselect = vi.fn();
  const { component } = render(AcpAtMentionCompletion, { query: '', onselect, oncancel: vi.fn() });

  const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
  const handled = (component as unknown as { handleKey: (e: KeyboardEvent) => boolean }).handleKey(event);

  expect(handled).toBe(true);
  expect(onselect).toHaveBeenCalled();
});

test('handleKey returns true for Escape', () => {
  const oncancel = vi.fn();
  const { component } = render(AcpAtMentionCompletion, { query: '', onselect: vi.fn(), oncancel });

  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  const handled = (component as unknown as { handleKey: (e: KeyboardEvent) => boolean }).handleKey(event);

  expect(handled).toBe(true);
  expect(oncancel).toHaveBeenCalled();
});

test('handleKey returns false for other keys', () => {
  const { component } = render(AcpAtMentionCompletion, { query: '', onselect: vi.fn(), oncancel: vi.fn() });

  const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
  const handled = (component as unknown as { handleKey: (e: KeyboardEvent) => boolean }).handleKey(event);

  expect(handled).toBe(false);
});
