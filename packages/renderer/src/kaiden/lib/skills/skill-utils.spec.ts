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

import { expect, test } from 'vitest';

import { countTopLevelEntries, formatTokenCount } from './skill-utils';

test('countTopLevelEntries should return the number of entries', () => {
  expect(
    countTopLevelEntries([
      { name: 'a', isDirectory: false },
      { name: 'b', isDirectory: true },
    ]),
  ).toBe(2);
});

test('countTopLevelEntries should return 0 for empty array', () => {
  expect(countTopLevelEntries([])).toBe(0);
});

test('formatTokenCount should return N/A for undefined', () => {
  expect(formatTokenCount(undefined)).toBe('N/A');
});

test('formatTokenCount should return token estimate for short text', () => {
  expect(formatTokenCount('hello')).toBe('~2 tokens');
});

test('formatTokenCount should use k suffix for large text', () => {
  const text = 'a'.repeat(7000);
  expect(formatTokenCount(text)).toMatch(/^~2\.0k tokens$/);
});
