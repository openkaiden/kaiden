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

import type { Provider } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AiLabDaemonClient } from '/@/helper/ai-lab-daemon-client';
import { ContainerHostResolver } from '/@/helper/container-host-resolver';
import { InferenceModelManager } from '/@/manager/inference-model-manager';

import { InversifyBinding } from './inversify-binding';
import { PodmanAiLabProviderSymbol } from './symbol';

vi.mock(import('@openkaiden/api'));

describe('InversifyBinding', () => {
  let aiLabProvider: Provider;
  let inversifyBinding: InversifyBinding;

  beforeEach(() => {
    vi.resetAllMocks();
    aiLabProvider = {} as Provider;
    inversifyBinding = new InversifyBinding(aiLabProvider);
  });

  test('should bind the provider and resolve helpers and managers as singletons', async () => {
    const container = await inversifyBinding.initBindings();

    expect(container.get(PodmanAiLabProviderSymbol)).toBe(aiLabProvider);
    expect(container.get(AiLabDaemonClient)).toBeInstanceOf(AiLabDaemonClient);
    expect(container.get(ContainerHostResolver)).toBeInstanceOf(ContainerHostResolver);
    const manager = await container.getAsync(InferenceModelManager);
    expect(manager).toBeInstanceOf(InferenceModelManager);
    expect(await container.getAsync(InferenceModelManager)).toBe(manager);
  });

  test('should unbind everything on dispose', async () => {
    const container = await inversifyBinding.initBindings();

    await inversifyBinding.dispose();

    expect(container.isBound(PodmanAiLabProviderSymbol)).toBe(false);
    expect(container.isBound(InferenceModelManager)).toBe(false);
  });
});
