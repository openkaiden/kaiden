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

import { AddonsCatalogExtension } from './addons-catalog-extension';
import { activate, deactivate } from './extension';

vi.mock(import('./addons-catalog-extension'));

const extensionContext = { subscriptions: [] } as unknown as ExtensionContext;

beforeEach(() => {
  vi.resetAllMocks();
});

test('activate waits for the extension to start', async () => {
  const started = Promise.withResolvers<void>();
  vi.mocked(AddonsCatalogExtension.prototype.activate).mockReturnValue(started.promise);
  let activated = false;

  const activation = activate(extensionContext).then(() => {
    activated = true;
  });
  await Promise.resolve();

  expect(AddonsCatalogExtension).toHaveBeenCalledWith(extensionContext);
  expect(activated).toBe(false);
  started.resolve();
  await activation;
  expect(activated).toBe(true);
});

test('deactivate waits for the extension to stop', async () => {
  vi.mocked(AddonsCatalogExtension.prototype.activate).mockResolvedValue(undefined);
  await activate(extensionContext);
  const stopped = Promise.withResolvers<void>();
  vi.mocked(AddonsCatalogExtension.prototype.deactivate).mockReturnValue(stopped.promise);
  let deactivated = false;

  const deactivation = deactivate().then(() => {
    deactivated = true;
  });
  await Promise.resolve();

  expect(AddonsCatalogExtension.prototype.deactivate).toHaveBeenCalled();
  expect(deactivated).toBe(false);
  stopped.resolve();
  await deactivation;
  expect(deactivated).toBe(true);
});
