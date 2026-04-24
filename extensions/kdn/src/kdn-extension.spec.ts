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

import type { ExtensionContext } from '@openkaiden/api';
import * as extensionApi from '@openkaiden/api';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import { KdnExtension } from './kdn-extension';

vi.mock(import('node:fs'));

let extensionContext: ExtensionContext;
let kdnExtension: KdnExtension;
let originalResourcesPathDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
});

afterAll(() => {
  if (originalResourcesPathDescriptor) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPathDescriptor);
  } else {
    delete (process as unknown as Record<string, unknown>).resourcesPath;
  }
});

beforeEach(() => {
  vi.resetAllMocks();

  Object.defineProperty(process, 'resourcesPath', {
    value: '/resources',
    writable: true,
    configurable: true,
  });

  extensionContext = {
    storagePath: '/storage',
    subscriptions: [],
  } as unknown as ExtensionContext;

  kdnExtension = new KdnExtension(extensionContext);
});

test('registers from extension storage when binary exists', async () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(extensionApi.process.exec).mockResolvedValue({
    command: 'kdn',
    stdout: '',
    stderr: 'kdn version 0.5.0',
  });
  vi.mocked(extensionApi.cli.createCliTool).mockReturnValue({ dispose: vi.fn() } as never);

  await kdnExtension.activate();

  expect(extensionApi.cli.createCliTool).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'kdn',
      version: '0.5.0',
      path: join('/storage', 'bin', 'kdn'),
      installationSource: 'extension',
    }),
  );
});

test('registers from system PATH when not in extension storage', async () => {
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(extensionApi.process.exec).mockResolvedValue({
    command: 'kdn',
    stdout: '',
    stderr: 'kdn version 1.0.0',
  });
  vi.mocked(extensionApi.cli.createCliTool).mockReturnValue({ dispose: vi.fn() } as never);

  await kdnExtension.activate();

  expect(extensionApi.cli.createCliTool).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'kdn',
      version: '1.0.0',
      path: 'kdn',
      installationSource: 'external',
    }),
  );
});

test('registers from bundled resources when not in extension storage or PATH', async () => {
  vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.mocked(extensionApi.process.exec).mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce({
    command: 'kdn',
    stdout: '',
    stderr: 'kdn version 0.4.0',
  });
  vi.mocked(extensionApi.cli.createCliTool).mockReturnValue({ dispose: vi.fn() } as never);

  await kdnExtension.activate();

  expect(extensionApi.cli.createCliTool).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'kdn',
      version: '0.4.0',
      path: join('/resources', 'kdn', 'kdn'),
      installationSource: 'extension',
    }),
  );
});

test('does not register when not found anywhere', async () => {
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('not found'));

  await kdnExtension.activate();

  expect(extensionApi.cli.createCliTool).not.toHaveBeenCalled();
});

test('pushes cli tool to subscriptions for cleanup', async () => {
  const disposable = { dispose: vi.fn() };
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(extensionApi.process.exec).mockResolvedValue({
    command: 'kdn',
    stdout: 'kdn version 0.5.0',
    stderr: '',
  });
  vi.mocked(extensionApi.cli.createCliTool).mockReturnValue(disposable as never);

  await kdnExtension.activate();

  expect(extensionContext.subscriptions).toContain(disposable);
});
