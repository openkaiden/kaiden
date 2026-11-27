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
import { Container } from 'inversify';
import { beforeEach, expect, test, vi } from 'vitest';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { CatalogManager } from '/@/manager/catalog-manager';

import { AddonsCatalogExtension } from './addons-catalog-extension';

vi.mock(import('/@/inject/inversify-binding'));
vi.mock(import('/@/manager/catalog-manager'));

const extensionContext = { subscriptions: [] } as unknown as ExtensionContext;

let extension: AddonsCatalogExtension;

beforeEach(() => {
  vi.resetAllMocks();
  const catalogManager = new CatalogManager(extensionContext);
  const container = new Container();
  container.bind(CatalogManager).toConstantValue(catalogManager);
  vi.mocked(InversifyBinding.prototype.initBindings).mockResolvedValue(container);
  extension = new AddonsCatalogExtension(extensionContext);
});

test('activate binds the container without waiting for the catalog', async () => {
  const loaded = Promise.withResolvers<void>();
  vi.mocked(CatalogManager.prototype.init).mockReturnValue(loaded.promise);

  await extension.activate();

  expect(InversifyBinding).toHaveBeenCalledWith(extensionContext);
  expect(CatalogManager.prototype.init).toHaveBeenCalled();
  loaded.resolve();
});

test('logs when the catalog fails to load', async () => {
  console.error = vi.fn();
  const error = new Error('boom');
  vi.mocked(CatalogManager.prototype.init).mockRejectedValue(error);

  await extension.activate();

  await vi.waitFor(() => expect(console.error).toHaveBeenCalledWith('Unable to load the addons catalog', error));
});

test('deactivate stops the catalog loading and disposes the bindings', async () => {
  vi.mocked(CatalogManager.prototype.init).mockResolvedValue(undefined);
  await extension.activate();
  await extension.deactivate();

  expect(CatalogManager.prototype.dispose).toHaveBeenCalled();
  expect(InversifyBinding.prototype.dispose).toHaveBeenCalled();
});
