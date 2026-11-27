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

import type { ContainerInfo } from 'dockerode';
import { beforeEach, expect, test, vi } from 'vitest';

import { SemanticRouterLabel } from '/@/api/semantic-router-container-info';

import { ContainerFinder } from './container-finder';

beforeEach(() => {
  vi.resetAllMocks();
});

test('filters containers with vllm-semantic-router labels', () => {
  const finder = new ContainerFinder();

  const containers = [
    {
      Id: '1',
      Names: ['/router-1'],
      Labels: { [SemanticRouterLabel.NAME]: 'my-router' },
    },
    { Id: '2', Names: ['/other'], Labels: {} },
    {
      Id: '3',
      Names: ['/router-2'],
      Labels: { [SemanticRouterLabel.NAME]: 'other-router' },
    },
    { Id: '4', Names: ['/no-labels'] },
  ] as unknown as ContainerInfo[];

  const found = finder.findSemanticRouterContainers(containers);

  expect(found).toHaveLength(2);
  expect(found.map(c => c.Id)).toEqual(['1', '3']);
});

test('returns empty array when no containers match', () => {
  const finder = new ContainerFinder();

  const containers = [
    { Id: '1', Labels: {} },
    { Id: '2', Labels: { 'some.other.label': 'value' } },
  ] as unknown as ContainerInfo[];

  const found = finder.findSemanticRouterContainers(containers);

  expect(found).toHaveLength(0);
});

test('finds containers that only carry the name label', () => {
  const finder = new ContainerFinder();

  const containers = [{ Id: '1', Labels: { [SemanticRouterLabel.NAME]: 'my-router' } }] as unknown as ContainerInfo[];

  const found = finder.findSemanticRouterContainers(containers);

  expect(found.map(c => c.Id)).toEqual(['1']);
  expect(found[0]?.Labels[SemanticRouterLabel.NAME]).toBe('my-router');
});
