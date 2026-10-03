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

import { beforeEach, expect, test, vi } from 'vitest';

import { DockerSocketLinuxFinder } from './docker-linux-finder';

vi.mock(import('node:fs'));

beforeEach(() => {
  vi.resetAllMocks();
  console.warn = vi.fn();
});

test('findPaths returns empty array when socket does not exist', async () => {
  const finder = new DockerSocketLinuxFinder();

  vi.mocked(existsSync).mockReturnValue(false);

  const result = await finder.findPaths();

  expect(result).toEqual([]);
  expect(existsSync).toHaveBeenCalledWith('/var/run/docker.sock');
});

test('findPaths returns socket path when socket exists', async () => {
  const finder = new DockerSocketLinuxFinder();

  vi.mocked(existsSync).mockReturnValue(true);

  const result = await finder.findPaths();

  expect(result).toEqual(['/var/run/docker.sock']);
});

test('findPaths reports a missing socket only once across repeated polls', async () => {
  const finder = new DockerSocketLinuxFinder();
  vi.mocked(existsSync).mockReturnValue(false);

  expect(await finder.findPaths()).toEqual([]);
  expect(await finder.findPaths()).toEqual([]);

  expect(console.warn).toHaveBeenCalledExactlyOnceWith('No active docker socket found.');
});

test('findPaths reports again when a discovered socket disappears', async () => {
  const finder = new DockerSocketLinuxFinder();
  vi.mocked(existsSync).mockReturnValue(false);
  await finder.findPaths();

  vi.mocked(existsSync).mockReturnValue(true);
  expect(await finder.findPaths()).not.toEqual([]);
  expect(console.warn).toHaveBeenCalledTimes(1);

  vi.mocked(existsSync).mockReturnValue(false);
  expect(await finder.findPaths()).toEqual([]);
  await finder.findPaths();

  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenLastCalledWith('No active docker socket found.');
});

test('findPaths does not report a missing socket when one is available', async () => {
  const finder = new DockerSocketLinuxFinder();
  vi.mocked(existsSync).mockReturnValue(true);

  expect(await finder.findPaths()).not.toEqual([]);
  expect(console.warn).not.toHaveBeenCalled();
});
