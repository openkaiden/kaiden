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

import AcpCopyButton from './AcpCopyButton.svelte';

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as Record<string, unknown>).clipboardWriteText = vi.fn().mockResolvedValue(undefined);
});

test('should render copy button with aria-label', () => {
  render(AcpCopyButton, { text: 'Hello world' });
  expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
});

test('should call clipboardWriteText with the provided text on click', async () => {
  render(AcpCopyButton, { text: 'Hello world' });
  const button = screen.getByRole('button', { name: 'Copy to clipboard' });
  await fireEvent.click(button);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('Hello world');
});

test('should call clipboardWriteText multiple times on repeated clicks', async () => {
  render(AcpCopyButton, { text: 'test text' });
  const button = screen.getByRole('button', { name: 'Copy to clipboard' });
  await fireEvent.click(button);
  await fireEvent.click(button);
  expect(window.clipboardWriteText).toHaveBeenCalledTimes(2);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('test text');
});
