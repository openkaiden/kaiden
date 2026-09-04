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
import { beforeEach, expect, test, vi } from 'vitest';

import { activate, deactivate } from './extension';
import { VllmSemanticRouterExtension } from './vllm-semantic-router-extension';

vi.mock(import('./vllm-semantic-router-extension'));

let extensionContextMock: ExtensionContext;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  extensionContextMock = {} as ExtensionContext;
});

test('activate initializes and activates the extension', async () => {
  await activate(extensionContextMock);

  expect(VllmSemanticRouterExtension.prototype.activate).toHaveBeenCalled();
});

test('deactivate calls deactivate on the extension', async () => {
  await activate(extensionContextMock);
  await deactivate();

  expect(VllmSemanticRouterExtension.prototype.deactivate).toHaveBeenCalled();
});
