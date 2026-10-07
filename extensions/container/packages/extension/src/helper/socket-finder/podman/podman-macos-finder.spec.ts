/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { process } from '@openkaiden/api';
import { Container } from 'inversify';
import { beforeEach, expect, test, vi } from 'vitest';

import { PodmanSocketMacOSFinder } from './podman-macos-finder';
import { PodmanVersionDetector } from './podman-version-detector';

vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));
vi.mock(import('node:path'));
vi.mock(import('@openkaiden/api'));

vi.mock(import('./podman-version-detector'));

let finder: PodmanSocketMacOSFinder;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(PodmanVersionDetector.prototype.getMajorVersion).mockResolvedValue(6);
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue('/home/user/.local/share/containers/podman/machine/podman.sock');
  vi.mocked(access).mockRejectedValue(new Error('socket does not exist'));

  const container = new Container();
  container.bind(PodmanSocketMacOSFinder).toSelf().inSingletonScope();
  container.bind(PodmanVersionDetector).toSelf().inSingletonScope();
  finder = await container.getAsync(PodmanSocketMacOSFinder);
});

test('findPaths returns socket path with --all-providers on podman 5', async () => {
  vi.mocked(PodmanVersionDetector.prototype.getMajorVersion).mockResolvedValue(5);

  const socketPath = '/home/user/.local/share/containers/podman/machine/podman.sock';
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue(socketPath);
  vi.mocked(access).mockResolvedValue(undefined);

  const machineListOutput = JSON.stringify([{ Name: 'podman-machine-default', VMType: 'qemu', Running: true }]);

  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: machineListOutput, stderr: '' });

  const result = await finder.findPaths();

  expect(result).toEqual([socketPath]);
  expect(process.exec).toHaveBeenCalledWith('podman', ['machine', 'ls', '--all-providers', '--format', 'json']);
});

test('findPaths returns socket path without --all-providers on podman 6', async () => {
  vi.mocked(PodmanVersionDetector.prototype.getMajorVersion).mockResolvedValue(6);

  const socketPath = '/home/user/.local/share/containers/podman/machine/podman.sock';
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue(socketPath);
  vi.mocked(access).mockResolvedValue(undefined);

  const machineListOutput = JSON.stringify([{ Name: 'podman-machine-default', VMType: 'qemu', Running: true }]);

  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: machineListOutput, stderr: '' });

  const result = await finder.findPaths();

  expect(result).toEqual([socketPath]);
  expect(process.exec).toHaveBeenCalledWith('podman', ['machine', 'ls', '--format', 'json']);
  expect(process.exec).toHaveBeenCalledTimes(1);
});

test('findPaths returns empty array when socket exists but no machines are running', async () => {
  const socketPath = '/home/user/.local/share/containers/podman/machine/podman.sock';
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue(socketPath);
  vi.mocked(access).mockResolvedValue(undefined);

  const machineListOutput = JSON.stringify([{ Name: 'podman-machine-default', VMType: 'qemu', Running: false }]);

  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: machineListOutput, stderr: '' });

  const result = await finder.findPaths();

  expect(result).toEqual([]);
});

test.each([
  { version: 5, provider: 'applehv', name: 'podman-machine-default' },
  { version: 5, provider: 'libkrun', name: 'custom-machine' },
  { version: 6, provider: 'applehv', name: 'podman-machine-apple' },
  { version: 6, provider: 'libkrun', name: 'podman-machine-default' },
])('discovers $name with $provider on Podman $version when the global socket is absent', async ({
  version,
  provider,
  name,
}) => {
  vi.mocked(PodmanVersionDetector.prototype.getMajorVersion).mockResolvedValue(version);
  const machineSocketPath = `/tmp/podman/${name}-api.sock`;
  vi.mocked(process.exec)
    .mockResolvedValueOnce({
      command: 'podman',
      stdout: JSON.stringify([{ Name: name, VMType: provider, Running: true }]),
      stderr: '',
    })
    .mockResolvedValueOnce({ command: 'podman', stdout: `${machineSocketPath}\n`, stderr: '' });
  vi.mocked(access).mockRejectedValueOnce(new Error('socket does not exist')).mockResolvedValueOnce(undefined);

  expect(await finder.findPaths()).toEqual([machineSocketPath]);
  expect(process.exec).toHaveBeenNthCalledWith(
    1,
    'podman',
    version === 5 ? ['machine', 'ls', '--all-providers', '--format', 'json'] : ['machine', 'ls', '--format', 'json'],
  );
  expect(process.exec).toHaveBeenNthCalledWith(
    2,
    'podman',
    ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', name],
    { env: { CONTAINERS_MACHINE_PROVIDER: provider } },
  );
  expect(access).toHaveBeenCalledWith(machineSocketPath);
});

test.each([
  { machines: [] },
  { machines: [{ Name: 'stopped-machine', VMType: 'applehv', Running: false }] },
])('does not inspect machines when none are running and the global socket is absent: $machines', async ({
  machines,
}) => {
  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: JSON.stringify(machines), stderr: '' });

  expect(await finder.findPaths()).toEqual([]);
  expect(process.exec).toHaveBeenCalledTimes(1);
  expect(access).not.toHaveBeenCalled();
});

test.each([
  '',
  ' \n',
  '/tmp/podman/missing-api.sock',
])('ignores an empty or missing inspected socket: %j', async stdout => {
  vi.mocked(process.exec)
    .mockResolvedValueOnce({
      command: 'podman',
      stdout: JSON.stringify([{ Name: 'custom-machine', VMType: 'applehv', Running: true }]),
      stderr: '',
    })
    .mockResolvedValueOnce({ command: 'podman', stdout, stderr: '' });

  expect(await finder.findPaths()).toEqual([]);
  expect(process.exec).toHaveBeenCalledTimes(2);
});

test('continues discovery after an inspection failure and excludes stopped machines', async () => {
  const machineSocketPath = '/tmp/podman/working-api.sock';
  vi.mocked(process.exec)
    .mockResolvedValueOnce({
      command: 'podman',
      stdout: JSON.stringify([
        { Name: 'failed-machine', VMType: 'applehv', Running: true },
        { Name: 'stopped-machine', VMType: 'libkrun', Running: false },
        { Name: 'working-machine', VMType: 'libkrun', Running: true },
      ]),
      stderr: '',
    })
    .mockRejectedValueOnce(new Error('machine disappeared'))
    .mockResolvedValueOnce({ command: 'podman', stdout: machineSocketPath, stderr: '' });
  vi.mocked(access).mockRejectedValueOnce(new Error('socket does not exist')).mockResolvedValueOnce(undefined);

  expect(await finder.findPaths()).toEqual([machineSocketPath]);
  expect(process.exec).toHaveBeenCalledTimes(3);
  expect(process.exec).toHaveBeenLastCalledWith(
    'podman',
    ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', 'working-machine'],
    { env: { CONTAINERS_MACHINE_PROVIDER: 'libkrun' } },
  );
});

test('returns each discovered socket only once', async () => {
  const machineSocketPath = '/tmp/podman/shared-api.sock';
  vi.mocked(process.exec)
    .mockResolvedValueOnce({
      command: 'podman',
      stdout: JSON.stringify([
        { Name: 'first-machine', VMType: 'applehv', Running: true },
        { Name: 'second-machine', VMType: 'libkrun', Running: true },
      ]),
      stderr: '',
    })
    .mockResolvedValue({ command: 'podman', stdout: machineSocketPath, stderr: '' });
  vi.mocked(access).mockResolvedValue(undefined).mockRejectedValueOnce(new Error('socket does not exist'));

  expect(await finder.findPaths()).toEqual([machineSocketPath]);
});

test('falls back to inspection when the global socket cannot be accessed', async () => {
  const machineSocketPath = '/tmp/podman/custom-api.sock';
  vi.mocked(process.exec)
    .mockResolvedValueOnce({
      command: 'podman',
      stdout: JSON.stringify([{ Name: 'custom-machine', VMType: 'applehv', Running: true }]),
      stderr: '',
    })
    .mockResolvedValueOnce({ command: 'podman', stdout: machineSocketPath, stderr: '' });
  vi.mocked(access).mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(undefined);

  expect(await finder.findPaths()).toEqual([machineSocketPath]);
});

test.each(['not JSON', '[{}]'])('returns no sockets when machine list output is invalid: %s', async stdout => {
  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout, stderr: '' });

  expect(await finder.findPaths()).toEqual([]);
  expect(process.exec).toHaveBeenCalledTimes(1);
});

test('returns no sockets when Podman cannot list machines', async () => {
  vi.mocked(process.exec).mockRejectedValue(new Error('podman not found'));

  expect(await finder.findPaths()).toEqual([]);
});

test('findPaths returns socket path when multiple machines exist and at least one is running', async () => {
  const socketPath = '/home/user/.local/share/containers/podman/machine/podman.sock';
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue(socketPath);
  vi.mocked(access).mockResolvedValue(undefined);

  const machineListOutput = JSON.stringify([
    { Name: 'podman-machine-1', VMType: 'qemu', Running: false },
    { Name: 'podman-machine-2', VMType: 'qemu', Running: true },
    { Name: 'podman-machine-3', VMType: 'qemu', Running: false },
  ]);

  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: machineListOutput, stderr: '' });

  const result = await finder.findPaths();

  expect(result).toEqual([socketPath]);
});

test('findPaths returns empty array when socket exists but machine list is empty', async () => {
  const socketPath = '/home/user/.local/share/containers/podman/machine/podman.sock';
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue(socketPath);
  vi.mocked(access).mockResolvedValue(undefined);

  const machineListOutput = JSON.stringify([]);

  vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: machineListOutput, stderr: '' });

  const result = await finder.findPaths();

  expect(result).toEqual([]);
});
