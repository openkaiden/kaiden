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
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { showChatWindow } from './chat-window';
import { configurationProperties } from './configurationProperties';

const getConfigurationValueMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'getConfigurationValue', { value: getConfigurationValueMock });
  showChatWindow.set(true);
});

afterEach(() => {
  showChatWindow.set(false);
});

test('showChatWindow is undefined before config loads', () => {
  showChatWindow.set(undefined);
  expect(get(showChatWindow)).toBeUndefined();
});

test('showChatWindow set to true when config value is true', async () => {
  showChatWindow.set(undefined);
  getConfigurationValueMock.mockResolvedValue(true);

  configurationProperties.set([]);

  await vi.waitFor(() => expect(get(showChatWindow)).toBe(true));
});

test('showChatWindow set to false when config value is false', async () => {
  getConfigurationValueMock.mockResolvedValue(false);

  configurationProperties.set([]);

  await vi.waitFor(() => expect(get(showChatWindow)).toBe(false));
});

test('showChatWindow ignores stale configuration reads', async () => {
  showChatWindow.set(undefined);

  let resolveFirst: (value: boolean) => void = () => {};
  const firstRead = new Promise<boolean>(resolve => {
    resolveFirst = resolve;
  });

  getConfigurationValueMock.mockReturnValueOnce(firstRead).mockResolvedValueOnce(true);

  // Trigger two reads — second resolves immediately, first is still pending
  configurationProperties.set([]);
  configurationProperties.set([]);

  // Second (newer) read should win
  await vi.waitFor(() => expect(get(showChatWindow)).toBe(true));

  // First (stale) read resolves with false — should be ignored
  resolveFirst(false);
  await Promise.resolve();

  expect(get(showChatWindow)).toBe(true);
});
