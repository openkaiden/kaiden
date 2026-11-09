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

import { create } from '@bufbuild/protobuf';
import { ProviderProfileSchema } from '@nvidia/openshell-sdk/raw';
import { beforeEach, expect, test } from 'vitest';

import { OpenshellProfileOwnership } from '/@/plugin/openshell-cli/openshell-profile-ownership.js';

class TestOpenshellProfileOwnership extends OpenshellProfileOwnership {
  getAnnotationKey(): string {
    return this.annotationKey;
  }

  getAnnotationValue(): string {
    return this.annotationValue;
  }

  getImportSource(): string {
    return this.importSource;
  }
}

let ownership: TestOpenshellProfileOwnership;

beforeEach(() => {
  ownership = new TestOpenshellProfileOwnership();
});

test('derives the annotation key from appId and lowercases the owner value and import source', () => {
  expect(ownership.getAnnotationKey()).toBe('ai.openkaiden.kaiden.owned-by');
  expect(ownership.getAnnotationValue()).toBe('kaiden');
  expect(ownership.getImportSource()).toBe('kaiden');
});

test('toImportItem annotates the profile and sets the import source', () => {
  const item = ownership.toImportItem(create(ProviderProfileSchema, { id: 'p' }));

  expect(item.source).toBe('kaiden');
  expect(item.profile?.id).toBe('p');
  expect(item.profile?.annotations).toEqual({ 'ai.openkaiden.kaiden.owned-by': 'kaiden' });
});

test('annotate keeps existing annotations and makes the profile owned', () => {
  const profile = create(ProviderProfileSchema, { id: 'p', annotations: { other: 'value' } });

  const annotated = ownership.annotate(profile);

  expect(annotated.annotations).toEqual({ other: 'value', 'ai.openkaiden.kaiden.owned-by': 'kaiden' });
  expect(ownership.isOwned(annotated)).toBe(true);
  expect(ownership.isOwned(profile)).toBe(false);
});

test('a profile annotated with another owner value is not owned', () => {
  const profile = create(ProviderProfileSchema, {
    id: 'p',
    annotations: { 'ai.openkaiden.kaiden.owned-by': 'Kaiden' },
  });

  expect(ownership.isOwned(profile)).toBe(false);
});
