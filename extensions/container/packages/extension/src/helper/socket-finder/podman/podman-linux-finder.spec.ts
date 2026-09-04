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

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { PathLike } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { PodmanSocketLinuxFinder } from './podman-linux-finder';

vi.mock(import('node:fs'));
vi.mock(import('node:child_process'));

let originalXdgRuntimeDir: string | undefined;
let originalFlatpakId: string | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  originalXdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
  originalFlatpakId = process.env.FLATPAK_ID;
  vi.mocked(spawn).mockReturnValue({
    on: vi.fn(),
    kill: vi.fn(),
  } as unknown as ChildProcess);
});

afterEach(() => {
  if (originalXdgRuntimeDir !== undefined) {
    process.env.XDG_RUNTIME_DIR = originalXdgRuntimeDir;
  } else {
    delete process.env.XDG_RUNTIME_DIR;
  }
  if (originalFlatpakId !== undefined) {
    process.env.FLATPAK_ID = originalFlatpakId;
  } else {
    delete process.env.FLATPAK_ID;
  }
});

test('findPaths returns rootless socket when it already exists without spawning', async () => {
  const finder = new PodmanSocketLinuxFinder();

  process.env.XDG_RUNTIME_DIR = '/run/user/1000';
  const expectedSocket = resolve('/run/user/1000', 'podman/podman.sock');
  vi.mocked(existsSync).mockImplementation((path: PathLike) => {
    return String(path) === expectedSocket;
  });

  const result = await finder.findPaths();

  expect(result).toContain(expectedSocket);
  expect(result).not.toContain('/run/podman/podman.sock');
  expect(spawn).not.toHaveBeenCalled();
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

test('dispose is safe to call when no process was spawned', () => {
  const finder = new PodmanSocketLinuxFinder();

  expect(() => finder.dispose()).not.toThrow();
});

describe('with fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('findPaths returns empty array when no sockets exist and podman service fails to start', async () => {
    const finder = new PodmanSocketLinuxFinder();

    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    vi.mocked(existsSync).mockReturnValue(false);

    const resultPromise = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    const result = await resultPromise;

    expect(result).toEqual([]);
    expect(spawn).toHaveBeenCalledWith('podman', ['system', 'service', '--time=0'], { stdio: 'ignore' });
  });

  test('findPaths returns rootful socket when rootless is unavailable', async () => {
    const finder = new PodmanSocketLinuxFinder();

    delete process.env.XDG_RUNTIME_DIR;
    const uid = process.getuid?.();
    const rootlessSocket = uid !== undefined ? resolve(`/run/user/${uid}`, 'podman/podman.sock') : undefined;

    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      if (String(path) === '/run/podman/podman.sock') return true;
      if (rootlessSocket && String(path) === rootlessSocket) return false;
      return false;
    });

    const resultPromise = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    const result = await resultPromise;

    expect(result).toEqual(['/run/podman/podman.sock']);
  });

  test('findPaths returns empty array when XDG_RUNTIME_DIR is not set and rootful socket does not exist', async () => {
    const finder = new PodmanSocketLinuxFinder();

    delete process.env.XDG_RUNTIME_DIR;
    vi.mocked(existsSync).mockReturnValue(false);

    const resultPromise = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    const result = await resultPromise;

    expect(result).toEqual([]);
  });

  test('findPaths spawns podman service when rootless socket does not exist and returns socket after it appears', async () => {
    const finder = new PodmanSocketLinuxFinder();

    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    const expectedSocket = resolve('/run/user/1000', 'podman/podman.sock');

    let callCount = 0;
    vi.mocked(existsSync).mockImplementation((path: PathLike) => {
      if (String(path) === expectedSocket) {
        callCount++;
        return callCount >= 3;
      }
      return false;
    });

    const resultPromise = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    const result = await resultPromise;

    expect(spawn).toHaveBeenCalledWith('podman', ['system', 'service', '--time=0'], { stdio: 'ignore' });
    expect(result).toContain(expectedSocket);
  });

  test('findPaths uses flatpak-spawn when FLATPAK_ID is set', async () => {
    const finder = new PodmanSocketLinuxFinder();

    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    process.env.FLATPAK_ID = 'com.example.app';
    vi.mocked(existsSync).mockReturnValue(false);

    const resultPromise = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    await resultPromise;

    expect(spawn).toHaveBeenCalledWith('flatpak-spawn', ['--host', 'podman', 'system', 'service', '--time=0'], {
      stdio: 'ignore',
    });
  });

  test('dispose kills the spawned podman process', async () => {
    const finder = new PodmanSocketLinuxFinder();
    const killMock = vi.fn();
    vi.mocked(spawn).mockReturnValue({
      on: vi.fn(),
      kill: killMock,
    } as unknown as ChildProcess);

    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    vi.mocked(existsSync).mockReturnValue(false);

    const resultPromise = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    await resultPromise;

    finder.dispose();

    expect(killMock).toHaveBeenCalled();
  });

  test('findPaths does not spawn a second process if one is already running', async () => {
    const finder = new PodmanSocketLinuxFinder();

    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    vi.mocked(existsSync).mockReturnValue(false);

    const resultPromise1 = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    await resultPromise1;

    const resultPromise2 = finder.findPaths();
    await vi.advanceTimersByTimeAsync(
      PodmanSocketLinuxFinder.SOCKET_WAIT_ATTEMPTS * PodmanSocketLinuxFinder.SOCKET_WAIT_INTERVAL_MS,
    );
    await resultPromise2;

    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
