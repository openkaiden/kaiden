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

import { faKey, faPlug } from '@fortawesome/free-solid-svg-icons';
import { describe, expect, test } from 'vitest';

import { getSecretIcon } from './secret-vault-utils';

describe('getSecretIcon', () => {
  test('returns the generic key icon when no type is available', () => {
    expect(getSecretIcon()).toBe(faKey);
  });

  test('treats unrecognized types like any other service', () => {
    expect(getSecretIcon('other')).toBe(faPlug);
  });

  test('treats an empty type like any other service', () => {
    expect(getSecretIcon('')).toBe(faPlug);
  });
});
