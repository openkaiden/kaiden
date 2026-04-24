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
import { KdnExtension } from './kdn-extension';

let extensionContextMock: ExtensionContext;

vi.mock(import('./kdn-extension'));

beforeEach(() => {
  vi.resetAllMocks();

  extensionContextMock = {} as ExtensionContext;
});

test('should initialize and activate the KdnExtension when activate is called', async () => {
  await activate(extensionContextMock);

  expect(KdnExtension.prototype.activate).toHaveBeenCalled();
});

test('should call deactivate when deactivate is called', async () => {
  await activate(extensionContextMock);

  await deactivate();

  expect(KdnExtension.prototype.deactivate).toHaveBeenCalled();
});
