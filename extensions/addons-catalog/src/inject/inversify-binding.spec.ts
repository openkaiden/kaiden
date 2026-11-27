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
import { beforeEach, expect, test } from 'vitest';

import { ExtensionContextSymbol } from '/@/inject/symbol';
import { CatalogManager } from '/@/manager/catalog-manager';

import { InversifyBinding } from './inversify-binding';

const extensionContext = { subscriptions: [] } as unknown as ExtensionContext;

let inversifyBinding: InversifyBinding;

beforeEach(() => {
  inversifyBinding = new InversifyBinding(extensionContext);
});

test('binds the extension context and the catalog manager', async () => {
  const container = await inversifyBinding.initBindings();

  expect(container.get(ExtensionContextSymbol)).toBe(extensionContext);
  expect(container.get(CatalogManager)).toBeInstanceOf(CatalogManager);
  expect(container.get(CatalogManager)).toBe(container.get(CatalogManager));
});

test('dispose unbinds everything', async () => {
  const container = await inversifyBinding.initBindings();

  await inversifyBinding.dispose();

  expect(container.isBound(CatalogManager)).toBe(false);
  expect(container.isBound(ExtensionContextSymbol)).toBe(false);
});
