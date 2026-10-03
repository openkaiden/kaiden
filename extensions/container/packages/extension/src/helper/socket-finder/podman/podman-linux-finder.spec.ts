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

import type { PathLike } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { PodmanSocketLinuxFinder } from './podman-linux-finder';

vi.mock(import('node:fs'));

let originalXdgRuntimeDir: string | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  console.warn = vi.fn();
  originalXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
});

afterEach(() => {
  if (originalXdgRuntimeDir !== undefined) {
    process.env.XDG_RUNTIME_DIR = originalXdgRuntimeDir;
  } else {
    delete process.env.XDG_RUNTIME_DIR;
  }
});

test('findPaths returns empty array when no sockets exist', async () => {
  const finder = new PodmanSocketLinuxFinder();

  process.env.XDG_RUNTIME_DIR = '/run/user/1000';
  vi.mocked(existsSync).mockReturnValue(false);

  const result = await finder.findPaths();

  expect(result).toEqual([]);
});

test('findPaths returns rootless socket when it exists', async () => {
  const finder = new PodmanSocketLinuxFinder();

  process.env.XDG_RUNTIME_DIR = '/run/user/1000';
  const expectedSocket = resolve('/run/user/1000', 'podman/podman.sock');
  vi.mocked(existsSync).mockImplementation((path: PathLike) => {
    return String(path) === expectedSocket;
  });

  const result = await finder.findPaths();

  expect(result).toContain(expectedSocket);
  expect(result).not.toContain('/run/podman/podman.sock');
});

test('findPaths returns rootful socket when it exists', async () => {
  const finder = new PodmanSocketLinuxFinder();

  delete process.env.XDG_RUNTIME_DIR;
  vi.mocked(existsSync).mockImplementation((path: PathLike) => {
    return String(path) === '/run/podman/podman.sock';
  });

  const result = await finder.findPaths();

  expect(result).toEqual(['/run/podman/podman.sock']);
});

test('findPaths returns both sockets when both exist', async () => {
  const finder = new PodmanSocketLinuxFinder();

  process.env.XDG_RUNTIME_DIR = '/run/user/1000';
  const expectedRootless = resolve('/run/user/1000', 'podman/podman.sock');
  vi.mocked(existsSync).mockReturnValue(true);

  const result = await finder.findPaths();

  expect(result).toHaveLength(2);
  expect(result).toContain(expectedRootless);
  expect(result).toContain('/run/podman/podman.sock');
});

test('findPaths returns empty array when XDG_RUNTIME_DIR is not set and rootful socket does not exist', async () => {
  const finder = new PodmanSocketLinuxFinder();

  delete process.env.XDG_RUNTIME_DIR;
  vi.mocked(existsSync).mockReturnValue(false);

  const result = await finder.findPaths();

  expect(result).toEqual([]);
});

test('findPaths falls back to /run/user/$UID when XDG_RUNTIME_DIR is unset', async () => {
  const finder = new PodmanSocketLinuxFinder();

  delete process.env.XDG_RUNTIME_DIR;
  const uid = process.getuid?.();
  const expectedSocket = resolve(`/run/user/${uid}`, 'podman/podman.sock');

  vi.mocked(existsSync).mockImplementation((path: PathLike) => {
    return String(path) === expectedSocket;
  });

  const result = await finder.findPaths();

  if (uid !== undefined) {
    expect(result).toContain(expectedSocket);
  }
});

test('findPaths reports a missing socket only once across repeated polls', async () => {
  const finder = new PodmanSocketLinuxFinder();
  vi.mocked(existsSync).mockReturnValue(false);

  expect(await finder.findPaths()).toEqual([]);
  expect(await finder.findPaths()).toEqual([]);

  expect(console.warn).toHaveBeenCalledExactlyOnceWith(
    'No active podman socket found. Enable it with "systemctl --user enable --now podman.socket".',
  );
});

test('findPaths reports again when a discovered socket disappears', async () => {
  const finder = new PodmanSocketLinuxFinder();
  vi.mocked(existsSync).mockReturnValue(false);
  await finder.findPaths();

  vi.mocked(existsSync).mockReturnValue(true);
  expect(await finder.findPaths()).not.toEqual([]);
  expect(console.warn).toHaveBeenCalledTimes(1);

  vi.mocked(existsSync).mockReturnValue(false);
  expect(await finder.findPaths()).toEqual([]);
  await finder.findPaths();

  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenLastCalledWith(
    'No active podman socket found. Enable it with "systemctl --user enable --now podman.socket".',
  );
});

test('findPaths does not report a missing socket when one is available', async () => {
  const finder = new PodmanSocketLinuxFinder();
  vi.mocked(existsSync).mockReturnValue(true);

  expect(await finder.findPaths()).not.toEqual([]);
  expect(console.warn).not.toHaveBeenCalled();
});
