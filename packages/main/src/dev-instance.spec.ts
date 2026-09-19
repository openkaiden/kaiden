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
import * as path from 'node:path';

import type { App as ElectronApp } from 'electron';
import { nativeImage } from 'electron';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { isMac } from '/@/util.js';

import { applyDevDockIcon, configureDevInstance, getDevIconPath } from './dev-instance.js';

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: vi.fn(),
  },
}));
vi.mock(import('/@/util.js'));

const APP_DATA_PATH = '/mock/appData';

function createMockApp(overrides?: Partial<ElectronApp>): ElectronApp {
  return {
    getPath: vi.fn().mockImplementation((name: string) => {
      if (name === 'appData') return APP_DATA_PATH;
      return `/mock/${name}`;
    }),
    getAppPath: vi.fn().mockReturnValue('/mock/appRoot'),
    setPath: vi.fn(),
    setName: vi.fn(),
    dock: {
      setIcon: vi.fn(),
    },
    ...overrides,
  } as unknown as ElectronApp;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('configureDevInstance', () => {
  test('should redirect userData to a dev-specific directory', () => {
    const app = createMockApp();

    configureDevInstance(app);

    expect(app.setPath).toHaveBeenCalledWith('userData', path.join(APP_DATA_PATH, 'kaiden-dev'));
  });

  test('should set app name to include Dev suffix', () => {
    const app = createMockApp();

    configureDevInstance(app);

    expect(app.setName).toHaveBeenCalledWith('Kaiden Dev');
  });
});

describe('applyDevDockIcon', () => {
  test('should set dock icon on macOS', () => {
    vi.mocked(isMac).mockReturnValue(true);
    const mockIcon = { mock: 'icon' };
    vi.mocked(nativeImage.createFromPath).mockReturnValue(mockIcon as never);
    const app = createMockApp();

    applyDevDockIcon(app);

    expect(nativeImage.createFromPath).toHaveBeenCalledWith(
      path.resolve('/mock/appRoot', 'buildResources/icon-dev.png'),
    );
    expect(app.dock?.setIcon).toHaveBeenCalledWith(mockIcon);
  });

  test('should not set dock icon on non-macOS', () => {
    vi.mocked(isMac).mockReturnValue(false);
    const app = createMockApp();

    applyDevDockIcon(app);

    expect(nativeImage.createFromPath).not.toHaveBeenCalled();
  });
});

describe('getDevIconPath', () => {
  test('should return resolved path to dev icon', () => {
    const app = createMockApp();

    const result = getDevIconPath(app);

    expect(result).toBe(path.resolve('/mock/appRoot', 'buildResources/icon-dev.png'));
  });
});
