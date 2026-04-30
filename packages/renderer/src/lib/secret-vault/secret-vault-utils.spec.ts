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

import {
  getSecretGroupLabel,
  isKnownService,
  KNOWN_GROUP_LABEL,
  KNOWN_SERVICES,
  OTHER_GROUP_LABEL,
} from './secret-vault-utils';

describe('KNOWN_SERVICES', () => {
  test('contains expected service names', () => {
    expect(KNOWN_SERVICES.has('github')).toBeTruthy();
    expect(KNOWN_SERVICES.has('gemini')).toBeTruthy();
    expect(KNOWN_SERVICES.has('anthropic')).toBeTruthy();
  });

  test('does not contain other or unknown types', () => {
    expect(KNOWN_SERVICES.has('other')).toBeFalsy();
    expect(KNOWN_SERVICES.has('unknown')).toBeFalsy();
  });
});

describe('isKnownService', () => {
  test.each(['github', 'gemini', 'anthropic'])('returns true for known service %s', type => {
    expect(isKnownService(type)).toBeTruthy();
  });

  test.each(['other', 'custom', 'unknown'])('returns false for non-known type %s', type => {
    expect(isKnownService(type)).toBeFalsy();
  });

  test('returns false when called without argument', () => {
    expect(isKnownService()).toBeFalsy();
  });
});

describe('getSecretGroupLabel', () => {
  test.each(['github', 'gemini', 'anthropic'])('returns known group label for %s', type => {
    expect(getSecretGroupLabel(type)).toBe(KNOWN_GROUP_LABEL);
  });

  test.each(['other', 'custom'])('returns other group label for %s', type => {
    expect(getSecretGroupLabel(type)).toBe(OTHER_GROUP_LABEL);
  });

  test('returns other group label when called without argument', () => {
    expect(getSecretGroupLabel()).toBe(OTHER_GROUP_LABEL);
  });
});
