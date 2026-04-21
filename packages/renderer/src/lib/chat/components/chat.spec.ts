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

import '@testing-library/jest-dom/vitest';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ModelInfo } from '/@/lib/chat/components/model-info';

import { findModel } from './chat.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('findModel', () => {
  const models: ModelInfo[] = [
    { providerId: 'ollama', connectionName: 'local', label: 'llama3', type: 'local' },
    { providerId: 'ollama', connectionName: 'local', label: 'mistral', type: 'local' },
    { providerId: 'gemini', connectionName: 'cloud', label: 'gemini-pro', type: 'cloud' },
  ];

  test('should return matching model when all fields match', () => {
    const target: ModelInfo = { providerId: 'ollama', connectionName: 'local', label: 'mistral', type: 'local' };
    const result = findModel(models, target);
    expect(result).toEqual(target);
  });

  test('should return undefined when model is undefined', () => {
    const result = findModel(models, undefined);
    expect(result).toBeUndefined();
  });

  test('should return undefined when no model matches', () => {
    const target: ModelInfo = { providerId: 'openai', connectionName: 'remote', label: 'gpt-4', type: 'cloud' };
    const result = findModel(models, target);
    expect(result).toBeUndefined();
  });

  test('should return undefined when label does not match', () => {
    const target: ModelInfo = { providerId: 'ollama', connectionName: 'local', label: 'nonexistent', type: 'local' };
    const result = findModel(models, target);
    expect(result).toBeUndefined();
  });

  test('should return undefined when providerId does not match', () => {
    const target: ModelInfo = { providerId: 'wrong-provider', connectionName: 'local', label: 'llama3', type: 'local' };
    const result = findModel(models, target);
    expect(result).toBeUndefined();
  });

  test('should return undefined when connectionName does not match', () => {
    const target: ModelInfo = {
      providerId: 'ollama',
      connectionName: 'wrong-connection',
      label: 'llama3',
      type: 'local',
    };
    const result = findModel(models, target);
    expect(result).toBeUndefined();
  });

  test('should return undefined when type does not match', () => {
    const target: ModelInfo = {
      providerId: 'ollama',
      connectionName: 'local',
      label: 'llama3',
      type: 'cloud',
    };
    const result = findModel(models, target);
    expect(result).toBeUndefined();
  });

  test('should return undefined when models list is empty', () => {
    const target: ModelInfo = { providerId: 'ollama', connectionName: 'local', label: 'llama3', type: 'local' };
    const result = findModel([], target);
    expect(result).toBeUndefined();
  });

  test('should return undefined when endpoint does not match', () => {
    const modelsWithEndpoint: ModelInfo[] = [
      { providerId: 'openai', connectionName: 'conn', label: 'gpt-4', type: 'cloud', endpoint: 'http://host-a/v1' },
    ];
    const target: ModelInfo = {
      providerId: 'openai',
      connectionName: 'conn',
      label: 'gpt-4',
      type: 'cloud',
      endpoint: 'http://host-b/v1',
    };
    const result = findModel(modelsWithEndpoint, target);
    expect(result).toBeUndefined();
  });

  test('should match models when both have undefined endpoint', () => {
    const target: ModelInfo = { providerId: 'ollama', connectionName: 'local', label: 'llama3', type: 'local' };
    const result = findModel(models, target);
    expect(result).toEqual(target);
  });
});
