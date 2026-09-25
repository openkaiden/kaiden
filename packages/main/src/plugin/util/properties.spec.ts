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

import { describe, expect, test } from 'vitest';

import { renameKeys } from './properties.js';

describe('renameKeys', () => {
  test('converts snake_case keys to camelCase', () => {
    expect(renameKeys({ display_name: 'hello' })).toEqual({ displayName: 'hello' });
  });

  test('handles multiple underscores', () => {
    expect(renameKeys({ my_long_key: 1 })).toEqual({ myLongKey: 1 });
  });

  test('leaves keys without underscores unchanged', () => {
    expect(renameKeys({ name: 'foo' })).toEqual({ name: 'foo' });
  });

  test('recursively renames nested object keys', () => {
    const input = { outer_key: { inner_key: 'value' } };
    expect(renameKeys(input)).toEqual({ outerKey: { innerKey: 'value' } });
  });

  test('recursively renames keys inside arrays', () => {
    const input = { items: [{ item_name: 'a' }, { item_name: 'b' }] };
    expect(renameKeys(input)).toEqual({ items: [{ itemName: 'a' }, { itemName: 'b' }] });
  });

  test('handles empty object', () => {
    expect(renameKeys({})).toEqual({});
  });

  test('handles empty array', () => {
    expect(renameKeys([])).toEqual([]);
  });

  test('preserves primitive values in arrays', () => {
    const input = { env_vars: ['FOO', 'BAR'] };
    expect(renameKeys(input)).toEqual({ envVars: ['FOO', 'BAR'] });
  });

  test('handles deeply nested structures', () => {
    const input = {
      top_level: {
        mid_level: [{ deep_key: { leaf_value: true } }],
      },
    };
    expect(renameKeys(input)).toEqual({
      topLevel: {
        midLevel: [{ deepKey: { leafValue: true } }],
      },
    });
  });

  test('preserves non-object values passed through arrays', () => {
    expect(renameKeys([1, 'two', true])).toEqual([1, 'two', true]);
  });
});
