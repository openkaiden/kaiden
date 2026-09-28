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

import type { ExtensionContext } from '@openkaiden/api';
import { openshell } from '@openkaiden/api';
import { beforeEach, expect, test, vi } from 'vitest';

import { activate, deactivate } from './extension';
import { VertexAi } from './vertex-ai';

vi.mock(import('@openkaiden/api'));
vi.mock(import('./vertex-ai'));
vi.mock('./google-vertex-ai.yaml?raw', () => ({ default: 'id: google-vertex-ai\ndisplay_name: Google Vertex AI\n' }));

beforeEach(() => {
  vi.resetAllMocks();
});

test('should initialize and activate the VertexAi extension', async () => {
  const extensionContextMock = {
    subscriptions: [],
    secrets: {},
  } as unknown as ExtensionContext;

  await activate(extensionContextMock);

  expect(VertexAi.prototype.init).toHaveBeenCalled();
  expect(extensionContextMock.subscriptions).toHaveLength(2);
});

test('activate registers openshell profile', async () => {
  const extensionContextMock = {
    subscriptions: [],
    secrets: {},
  } as unknown as ExtensionContext;

  await activate(extensionContextMock);

  expect(openshell.registerProfile).toHaveBeenCalledWith(expect.any(String));
});

test('should call deactivate without errors', async () => {
  const extensionContextMock = {
    subscriptions: [],
    secrets: {},
  } as unknown as ExtensionContext;

  await activate(extensionContextMock);
  deactivate();
});
