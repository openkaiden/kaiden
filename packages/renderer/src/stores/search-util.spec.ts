/**********************************************************************
 * Copyright (C) 2022 Red Hat, Inc.
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

import { beforeEach, expect, test, vi } from 'vitest';

import { findMatchInLeaves, matchesAllTokens } from './search-util';

beforeEach(() => {
  vi.clearAllMocks();
});

test('should expect valid match with string', async () => {
  const object = 'nginx';
  expect(findMatchInLeaves(object, 'nginx')).toBe(true);
  expect(findMatchInLeaves(object, 'foo')).toBe(false);
});

test('should expect valid match with string and case', async () => {
  const object = 'NgInX';
  expect(findMatchInLeaves(object, 'nginx')).toBe(true);
  expect(findMatchInLeaves(object, 'foo')).toBe(false);

  const object2 = 'nginx';
  expect(findMatchInLeaves(object2, 'NgInX')).toBe(true);
  expect(findMatchInLeaves(object2, 'foo')).toBe(false);
});

test('should expect valid match with array of string', async () => {
  const object = ['a', 'b', 'my super name'];
  expect(findMatchInLeaves(object, 'name')).toBe(true);
  expect(findMatchInLeaves(object, 'b')).toBe(true);
  expect(findMatchInLeaves(object, 'foo')).toBe(false);
});

test('should expect valid match with array of string and different case', async () => {
  const object = ['a', 'B', 'My Super Name'];
  expect(findMatchInLeaves(object, 'name')).toBe(true);
  expect(findMatchInLeaves(object, 'b')).toBe(true);
  expect(findMatchInLeaves(object, 'foo')).toBe(false);

  const object2 = ['a', 'b', 'my super name'];
  expect(findMatchInLeaves(object2, 'NaMe')).toBe(true);
  expect(findMatchInLeaves(object2, 'B')).toBe(true);
  expect(findMatchInLeaves(object2, 'foo')).toBe(false);
});

test('should expect valid match with simple object', async () => {
  const object = {
    hello: 'foo',
    baz: undefined,
  };
  expect(findMatchInLeaves(object, 'foo')).toBe(true);

  // should not match on key name
  expect(findMatchInLeaves(object, 'hello')).toBe(false);
});

test('should expect valid match with complex object', async () => {
  const object = {
    hello: {
      hello: {
        hello: 'foo',
      },
    },
  };
  expect(findMatchInLeaves(object, 'foo')).toBe(true);

  // should not match on key name
  expect(findMatchInLeaves(object, 'hello')).toBe(false);
});

test('should expect valid match with complex object and case', async () => {
  const object = {
    hello: {
      hello: {
        hello: 'FoO',
      },
    },
  };
  expect(findMatchInLeaves(object, 'foo')).toBe(true);

  // should not match on key name
  expect(findMatchInLeaves(object, 'hello')).toBe(false);
});

test.each<[text: string, query: string, expected: boolean]>([
  ['gpt-5-chat openai', 'chat-5', true],
  ['gpt-5-chat openai', 'chat 5 openai', true],
  ['gpt-5-chat openai', 'chat-6', false],
  ['chatgpt-4o-latest', 'chat-5', false],
])('matchesAllTokens(%s, %s) is %s', (text, query, expected) => {
  expect(matchesAllTokens(text, query)).toBe(expected);
});

test.each([
  'chat latest',
  'chat-latest',
  'chat_latest',
])('matchesAllTokens should split the query on whitespace, hyphens and underscores: %s', query => {
  expect(matchesAllTokens('chatgpt-4o-latest', query)).toBe(true);
});

test('matchesAllTokens should ignore case', () => {
  expect(matchesAllTokens('GPT-5-Chat', 'cHaT-5')).toBe(true);
});

test('matchesAllTokens should match everything with an empty query', () => {
  expect(matchesAllTokens('gpt-5-chat', '')).toBe(true);
});
