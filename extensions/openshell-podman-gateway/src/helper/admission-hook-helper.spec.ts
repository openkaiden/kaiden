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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Container } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ExtensionContextSymbol } from '/@/inject/symbol';

import { AdmissionHookHelper } from './admission-hook-helper';

vi.mock(import('node:fs'));

const EXTENSION_PATH = '/extensions/openshell-podman-gateway';
const DEV_HOOK_DIR = join(EXTENSION_PATH, 'assets', `${process.platform}-${process.arch}`);

let admissionHookHelper: AdmissionHookHelper;
let originalResourcesPath: PropertyDescriptor | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

  const container = new Container();
  container.bind(AdmissionHookHelper).toSelf();
  container.bind(ExtensionContextSymbol).toConstantValue({ extensionUri: { fsPath: EXTENSION_PATH } });

  admissionHookHelper = await container.getAsync<AdmissionHookHelper>(AdmissionHookHelper);
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (originalResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  } else {
    Reflect.deleteProperty(process, 'resourcesPath');
  }
});

describe('getHookDirectory', () => {
  test('returns the resources folder in production mode', () => {
    vi.stubEnv('PROD', true);
    Object.defineProperty(process, 'resourcesPath', { value: '/resources', configurable: true });
    vi.mocked(existsSync).mockReturnValue(true);

    expect(admissionHookHelper.getHookDirectory()).toBe(join('/resources', 'openshell-admission-hook'));
    expect(existsSync).toHaveBeenCalledWith(join('/resources', 'openshell-admission-hook', 'openshell-admission-hook'));
  });

  test('returns undefined in production mode when resourcesPath is not set', () => {
    vi.stubEnv('PROD', true);
    Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true });
    vi.mocked(existsSync).mockReturnValue(true);

    expect(admissionHookHelper.getHookDirectory()).toBeUndefined();
  });

  test('returns the extension assets folder in development mode', () => {
    vi.stubEnv('PROD', false);
    vi.mocked(existsSync).mockReturnValue(true);

    expect(admissionHookHelper.getHookDirectory()).toBe(DEV_HOOK_DIR);
    expect(existsSync).toHaveBeenCalledWith(join(DEV_HOOK_DIR, 'openshell-admission-hook'));
  });

  test('returns undefined when the binary is missing', () => {
    vi.stubEnv('PROD', false);
    vi.mocked(existsSync).mockReturnValue(false);

    expect(admissionHookHelper.getHookDirectory()).toBeUndefined();
  });
});
