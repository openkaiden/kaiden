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

import type { ExtensionContext, Provider, SecretStorage } from '@openkaiden/api';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { managersModule } from '/@/manager/_manager-module';
import { MistralInferenceManager } from '/@/manager/mistral-inference-manager';
import { MistralSkillsManager } from '/@/manager/mistral-skills-manager';

import { InversifyBinding } from './inversify-binding';
import { ExtensionContextSymbol, MistralProviderSymbol, SecretStorageSymbol } from './symbol';

let inversifyBinding: InversifyBinding;

const providerMock = {} as Provider;
const secretStorageMock = {} as SecretStorage;
const extensionContextMock = { secrets: secretStorageMock } as ExtensionContext;

vi.mock(import('inversify'));

describe('InversifyBinding', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inversifyBinding = new InversifyBinding(providerMock, extensionContextMock);
    vi.mocked(Container.prototype.bind).mockReturnValue({
      toConstantValue: vi.fn(),
    } as unknown as ReturnType<typeof Container.prototype.bind>);
  });

  test('should initialize bindings correctly', async () => {
    const container = await inversifyBinding.initBindings();

    await container.getAsync(MistralSkillsManager);
    await container.getAsync(MistralInferenceManager);

    expect(vi.mocked(Container.prototype.bind)).toHaveBeenCalledWith(ExtensionContextSymbol);
    expect(vi.mocked(Container.prototype.bind)).toHaveBeenCalledWith(MistralProviderSymbol);
    expect(vi.mocked(Container.prototype.bind)).toHaveBeenCalledWith(SecretStorageSymbol);

    expect(vi.mocked(Container.prototype.load)).toHaveBeenCalledWith(managersModule);
  });

  test('should dispose of the container', async () => {
    const container = await inversifyBinding.initBindings();

    await inversifyBinding.dispose();

    expect(container.unbindAll).toHaveBeenCalled();
  });
});
