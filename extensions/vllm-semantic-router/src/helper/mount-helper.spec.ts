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

import { env } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { MountHelper } from './mount-helper';

let helper: MountHelper;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(env).isWindows = false;
  helper = new MountHelper();
});

test('binds the files read-only with SELinux relabelling', () => {
  expect(
    helper.getReadOnlyFileBinds([
      { source: '/home/me/.local/share/configs/r/config.yaml', target: '/app/config.yaml' },
      { source: '/home/me/.local/share/configs/r/envoy.yaml', target: '/etc/envoy/envoy.yaml' },
    ]),
  ).toEqual([
    '/home/me/.local/share/configs/r/config.yaml:/app/config.yaml:ro,Z',
    '/home/me/.local/share/configs/r/envoy.yaml:/etc/envoy/envoy.yaml:ro,Z',
  ]);
});

describe('on Windows', () => {
  beforeEach(() => {
    vi.mocked(env).isWindows = true;
  });

  test.each([
    ['C:\\Users\\me\\configs\\r\\config.yaml', '/mnt/c/Users/me/configs/r/config.yaml'],
    ['D:/data/config.yaml', '/mnt/d/data/config.yaml'],
    ['/already/linux/config.yaml', '/already/linux/config.yaml'],
  ])('binds %s from its WSL path %s', (source, wslPath) => {
    expect(helper.getReadOnlyFileBinds([{ source, target: '/app/config.yaml' }])).toEqual([
      `${wslPath}:/app/config.yaml:ro,Z`,
    ]);
  });
});
