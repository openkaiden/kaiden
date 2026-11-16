/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
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

import type { ExtensionContext, Provider } from '@openkaiden/api';
import { provider } from '@openkaiden/api';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { InversifyBinding } from '/@/inject/inversify-binding';
import { InferenceModelManager } from '/@/manager/inference-model-manager';

import { PodmanAiLabExtension } from './podman-ai-lab-extension';

vi.mock(import('@openkaiden/api'));
vi.mock(import('/@/inject/inversify-binding'));
vi.mock(import('/@/manager/inference-model-manager'));

describe('PodmanAiLabExtension', () => {
  let extensionContext: ExtensionContext;
  let aiLabProvider: Provider;
  let container: Container;
  let extension: PodmanAiLabExtension;

  beforeEach(() => {
    vi.resetAllMocks();
    aiLabProvider = {} as Provider;
    vi.mocked(provider.createProvider).mockReturnValue(aiLabProvider);
    container = new Container();
    container.bind(InferenceModelManager).toConstantValue(new InferenceModelManager());
    vi.mocked(InversifyBinding.prototype.initBindings).mockResolvedValue(container);
    extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
    extension = new PodmanAiLabExtension(extensionContext);
  });

  test('should create the provider and initialize the inference model manager', async () => {
    await extension.activate();

    expect(provider.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Podman AI Lab', id: 'podman-ai-lab' }),
    );
    expect(extensionContext.subscriptions).toContain(aiLabProvider);
    expect(InversifyBinding).toHaveBeenCalledWith(aiLabProvider);
    expect(InferenceModelManager.prototype.init).toHaveBeenCalled();
  });

  test('should rethrow when the inference model manager cannot be created', async () => {
    vi.mocked(InversifyBinding.prototype.initBindings).mockResolvedValue(new Container());

    await expect(extension.activate()).rejects.toThrow();
    expect(InferenceModelManager.prototype.init).not.toHaveBeenCalled();
  });

  test('should dispose the manager and the bindings on deactivate', async () => {
    await extension.activate();

    await extension.deactivate();

    expect(InferenceModelManager.prototype.dispose).toHaveBeenCalled();
    expect(InversifyBinding.prototype.dispose).toHaveBeenCalled();
  });
});
