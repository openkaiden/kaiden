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
import Dockerode from 'dockerode';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DockerodeHelper } from '/@/helper/container/dockerode-helper';

import { PodmanSocketMacOSFinder } from './podman-macos-finder';
import { PodmanVersionDetector } from './podman-version-detector';

vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));
vi.mock(import('node:path'));
vi.mock(import('@openkaiden/api'));
vi.mock(import('dockerode'));
vi.mock(import('/@/helper/container/dockerode-helper'));

const versionDetectorMock = {
  getMajorVersion: vi.fn(),
} as unknown as PodmanVersionDetector;

let finder: PodmanSocketMacOSFinder;

function enoent(message = 'socket does not exist'): Error {
  return Object.assign(new Error(message), { code: 'ENOENT' });
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.mocked(DockerodeHelper.prototype.getConnection).mockResolvedValue(new Dockerode());
  vi.mocked(versionDetectorMock.getMajorVersion).mockResolvedValue(6);

  const container = new Container();
  container.bind(DockerodeHelper).toSelf().inSingletonScope();
  container.bind(PodmanSocketMacOSFinder).toSelf().inSingletonScope();
  container.bind(PodmanVersionDetector).toConstantValue(versionDetectorMock);
  finder = await container.getAsync(PodmanSocketMacOSFinder);
});

test('findPaths prefers a healthy shared socket without any Podman CLI calls', async () => {
  const socketPath = '/home/user/.local/share/containers/podman/machine/podman.sock';
  vi.mocked(homedir).mockReturnValue('/home/user');
  vi.mocked(resolve).mockReturnValue(socketPath);
  vi.mocked(access).mockResolvedValue(undefined);

  expect(await finder.findPaths()).toEqual([socketPath]);
  expect(await finder.findPaths()).toEqual([socketPath]);
  expect(DockerodeHelper.prototype.getConnection).toHaveBeenCalledWith(socketPath);
  expect(versionDetectorMock.getMajorVersion).not.toHaveBeenCalled();
  expect(process.exec).not.toHaveBeenCalled();
});

describe('machine socket fallback', () => {
  beforeEach(() => {
    vi.mocked(homedir).mockReturnValue('/home/user');
    vi.mocked(resolve).mockReturnValue('/home/user/.local/share/containers/podman/machine/podman.sock');
    vi.mocked(access).mockRejectedValue(enoent('socket does not exist'));
    console.debug = vi.fn();
  });

  test.each([
    {
      version: 5,
      provider: 'applehv',
      name: 'podman-machine-default',
      lsArgs: ['machine', 'ls', '--all-providers', '--format', 'json'],
    },
    {
      version: 5,
      provider: 'libkrun',
      name: 'custom-machine',
      lsArgs: ['machine', 'ls', '--all-providers', '--format', 'json'],
    },
    { version: 6, provider: 'applehv', name: 'podman-machine-apple', lsArgs: ['machine', 'ls', '--format', 'json'] },
    { version: 6, provider: 'libkrun', name: 'podman-machine-default', lsArgs: ['machine', 'ls', '--format', 'json'] },
  ])('findPaths discovers $name with $provider on Podman $version when the global socket is absent', async ({
    version,
    provider,
    name,
    lsArgs,
  }) => {
    vi.mocked(versionDetectorMock.getMajorVersion).mockResolvedValue(version);
    const machineSocketPath = `/tmp/podman/${name}-api.sock`;
    vi.mocked(process.exec)
      .mockResolvedValueOnce({
        command: 'podman',
        stdout: JSON.stringify([{ Name: name, VMType: provider, Running: true }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ command: 'podman', stdout: `${machineSocketPath}\n`, stderr: '' });
    vi.mocked(access).mockRejectedValueOnce(enoent('socket does not exist')).mockResolvedValueOnce(undefined);

    expect(await finder.findPaths()).toEqual([machineSocketPath]);
    expect(process.exec).toHaveBeenNthCalledWith(1, 'podman', lsArgs);
    expect(process.exec).toHaveBeenNthCalledWith(
      2,
      'podman',
      ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', name],
      { env: { CONTAINERS_MACHINE_PROVIDER: provider } },
    );
    expect(access).toHaveBeenCalledWith(machineSocketPath);
    expect(console.debug).not.toHaveBeenCalled();
  });

  test.each([
    { machines: [] },
    { machines: [{ Name: 'stopped-machine', VMType: 'applehv', Running: false }] },
  ])('findPaths does not inspect machines when none are running and the global socket is absent: $machines', async ({
    machines,
  }) => {
    vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout: JSON.stringify(machines), stderr: '' });

    expect(await finder.findPaths()).toEqual([]);
    expect(process.exec).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledTimes(1);
  });

  test.each([
    '',
    ' \n',
    '/tmp/podman/missing-api.sock',
  ])('findPaths ignores an empty or missing inspected socket: %j', async stdout => {
    vi.mocked(process.exec)
      .mockResolvedValueOnce({
        command: 'podman',
        stdout: JSON.stringify([{ Name: 'custom-machine', VMType: 'applehv', Running: true }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ command: 'podman', stdout, stderr: '' });

    expect(await finder.findPaths()).toEqual([]);
    expect(process.exec).toHaveBeenCalledTimes(2);
    expect(console.debug).not.toHaveBeenCalled();
  });

  test('findPaths continues discovery after an inspection failure and excludes stopped machines', async () => {
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
    vi.mocked(access).mockRejectedValueOnce(enoent('socket does not exist')).mockResolvedValueOnce(undefined);

    expect(await finder.findPaths()).toEqual([machineSocketPath]);
    expect(process.exec).toHaveBeenCalledTimes(3);
    expect(process.exec).toHaveBeenLastCalledWith(
      'podman',
      ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', 'working-machine'],
      { env: { CONTAINERS_MACHINE_PROVIDER: 'libkrun' } },
    );
  });

  test('findPaths returns each discovered socket only once', async () => {
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
    vi.mocked(access).mockResolvedValue(undefined).mockRejectedValueOnce(enoent('socket does not exist'));

    expect(await finder.findPaths()).toEqual([machineSocketPath]);
  });

  test('findPaths falls back to inspection when the global socket cannot be accessed', async () => {
    const machineSocketPath = '/tmp/podman/custom-api.sock';
    vi.mocked(process.exec)
      .mockResolvedValueOnce({
        command: 'podman',
        stdout: JSON.stringify([{ Name: 'custom-machine', VMType: 'applehv', Running: true }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ command: 'podman', stdout: machineSocketPath, stderr: '' });
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(access).mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

    expect(await finder.findPaths()).toEqual([machineSocketPath]);
    expect(console.debug).toHaveBeenCalledWith(
      'PodmanSocketMacOSFinder: socket unavailable at /home/user/.local/share/containers/podman/machine/podman.sock',
      error,
    );
  });

  test('findPaths falls back when the shared socket exists but does not answer the API ping', async () => {
    const path = '/tmp/podman/working-api.sock';
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(DockerodeHelper.prototype.getConnection).mockRejectedValueOnce(new Error('connection refused'));
    vi.mocked(process.exec)
      .mockResolvedValueOnce({
        command: 'podman',
        stdout: JSON.stringify([{ Name: 'working', VMType: 'applehv', Running: true }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ command: 'podman', stdout: path, stderr: '' });

    expect(await finder.findPaths()).toEqual([path]);
  });

  test.each([
    'not JSON',
    '[{}]',
  ])('findPaths returns no sockets when machine list output is invalid: %s', async stdout => {
    vi.mocked(process.exec).mockResolvedValue({ command: 'podman', stdout, stderr: '' });

    expect(await finder.findPaths()).toEqual([]);
    expect(process.exec).toHaveBeenCalledTimes(1);
  });

  test('findPaths returns no sockets when Podman cannot list machines', async () => {
    vi.mocked(process.exec).mockRejectedValue(new Error('podman not found'));

    expect(await finder.findPaths()).toEqual([]);
  });

  describe('cached sockets', () => {
    const machine = { Name: 'custom-machine', VMType: 'applehv', Running: true };
    const machineListResult = { command: 'podman', stdout: JSON.stringify([machine]), stderr: '' };
    const machineSocketPath = '/tmp/podman/custom-api.sock';
    const inspectResult = { command: 'podman', stdout: machineSocketPath, stderr: '' };

    beforeEach(() => {
      vi.mocked(process.exec)
        .mockResolvedValue(machineListResult)
        .mockResolvedValueOnce(machineListResult)
        .mockResolvedValueOnce(inspectResult);
      vi.mocked(access).mockImplementation(async path => {
        if (path === '/home/user/.local/share/containers/podman/machine/podman.sock') {
          throw enoent('socket does not exist');
        }
      });
    });

    test('findPaths reuses an accessible socket while continuing to list machines', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      expect(await finder.findPaths()).toEqual([machineSocketPath]);

      expect(process.exec).toHaveBeenCalledTimes(4);
      expect(process.exec).toHaveBeenLastCalledWith('podman', ['machine', 'ls', '--format', 'json']);
      expect(access).toHaveBeenLastCalledWith(machineSocketPath);
    });

    test('findPaths inspects only new machines and ignores list ordering', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      const newMachine = { Name: 'new-machine', VMType: 'libkrun', Running: true };
      const newSocketPath = '/tmp/podman/new-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce({ command: 'podman', stdout: JSON.stringify([machine, newMachine]), stderr: '' })
        .mockResolvedValueOnce({ command: 'podman', stdout: newSocketPath, stderr: '' });

      expect(await finder.findPaths()).toEqual([machineSocketPath, newSocketPath]);
      expect(process.exec).toHaveBeenCalledTimes(4);
      expect(process.exec).toHaveBeenLastCalledWith(
        'podman',
        ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', 'new-machine'],
        { env: { CONTAINERS_MACHINE_PROVIDER: 'libkrun' } },
      );

      vi.mocked(process.exec).mockResolvedValueOnce({
        command: 'podman',
        stdout: JSON.stringify([newMachine, machine]),
        stderr: '',
      });
      expect(await finder.findPaths()).toEqual([newSocketPath, machineSocketPath]);
      expect(process.exec).toHaveBeenCalledTimes(5);
    });

    test.each([
      { state: 'removed', machines: [] },
      { state: 'stopped', machines: [{ ...machine, Running: false }] },
      { state: 'removed while another machine runs', machines: [{ Name: 'other', VMType: 'libkrun', Running: true }] },
    ])('findPaths evicts a $state machine before it starts again', async ({ machines }) => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      vi.mocked(process.exec)
        .mockResolvedValueOnce({ command: 'podman', stdout: JSON.stringify(machines), stderr: '' })
        .mockResolvedValue({ command: 'podman', stdout: '', stderr: '' });
      expect(await finder.findPaths()).toEqual([]);

      const restartedSocketPath = '/tmp/podman/restarted-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce(machineListResult)
        .mockResolvedValueOnce({ command: 'podman', stdout: restartedSocketPath, stderr: '' });
      expect(await finder.findPaths()).toEqual([restartedSocketPath]);
      expect(process.exec).toHaveBeenLastCalledWith(
        'podman',
        ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', machine.Name],
        { env: { CONTAINERS_MACHINE_PROVIDER: machine.VMType } },
      );
    });

    test('findPaths inspects a machine again when its provider changes', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      const newSocketPath = '/tmp/podman/libkrun-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce({
          command: 'podman',
          stdout: JSON.stringify([{ ...machine, VMType: 'libkrun' }]),
          stderr: '',
        })
        .mockResolvedValueOnce({ command: 'podman', stdout: newSocketPath, stderr: '' });

      expect(await finder.findPaths()).toEqual([newSocketPath]);
      expect(process.exec).toHaveBeenLastCalledWith(
        'podman',
        ['machine', 'inspect', '--format', '{{.ConnectionInfo.PodmanSocket.Path}}', machine.Name],
        { env: { CONTAINERS_MACHINE_PROVIDER: 'libkrun' } },
      );
    });

    test('findPaths refreshes a missing cached socket even if the machine list is unchanged', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      vi.mocked(access)
        .mockRejectedValueOnce(enoent('shared socket absent'))
        .mockRejectedValueOnce(enoent('cached socket absent'));
      const newSocketPath = '/tmp/podman/restarted-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce(machineListResult)
        .mockResolvedValueOnce({ command: 'podman', stdout: newSocketPath, stderr: '' });

      expect(await finder.findPaths()).toEqual([newSocketPath]);
      expect(await finder.findPaths()).toEqual([newSocketPath]);
      expect(process.exec).toHaveBeenCalledTimes(5);
      expect(console.debug).not.toHaveBeenCalled();
    });

    test('findPaths backs off failed inspection retries while continuing to list machines', async () => {
      vi.useFakeTimers();
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      vi.mocked(access)
        .mockRejectedValueOnce(enoent('shared socket absent'))
        .mockRejectedValueOnce(enoent('cached socket absent'));
      vi.mocked(process.exec)
        .mockResolvedValueOnce(machineListResult)
        .mockRejectedValueOnce(new Error('inspection failed'));
      expect(await finder.findPaths()).toEqual([]);

      vi.mocked(access).mockRejectedValue(enoent());
      expect(await finder.findPaths()).toEqual([]);
      expect(process.exec).toHaveBeenCalledTimes(5);
      vi.advanceTimersByTime(PodmanSocketMacOSFinder.INSPECT_RETRY_DELAY_MS);
      vi.mocked(access)
        .mockRejectedValueOnce(enoent())
        .mockRejectedValueOnce(enoent())
        .mockResolvedValueOnce(undefined);
      vi.mocked(process.exec).mockResolvedValueOnce(machineListResult).mockResolvedValueOnce(inspectResult);
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      expect(process.exec).toHaveBeenCalledTimes(7);
    });

    test('findPaths retains an inspected path that becomes healthy without another inspection', async () => {
      vi.mocked(access).mockRejectedValue(enoent());
      expect(await finder.findPaths()).toEqual([]);
      expect(await finder.findPaths()).toEqual([]);
      expect(process.exec).toHaveBeenCalledTimes(3);

      vi.mocked(access).mockRejectedValueOnce(enoent()).mockResolvedValueOnce(undefined);
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      expect(process.exec).toHaveBeenCalledTimes(4);
      expect(process.exec).toHaveBeenLastCalledWith('podman', ['machine', 'ls', '--format', 'json']);
    });

    test('findPaths reinspects when a cached socket stops answering the API ping', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      vi.mocked(DockerodeHelper.prototype.getConnection).mockRejectedValueOnce(new Error('connection refused'));
      const newSocketPath = '/tmp/podman/replacement-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce(machineListResult)
        .mockResolvedValueOnce({ command: 'podman', stdout: newSocketPath, stderr: '' });

      expect(await finder.findPaths()).toEqual([newSocketPath]);
      expect(await finder.findPaths()).toEqual([newSocketPath]);
      expect(process.exec).toHaveBeenCalledTimes(5);
    });

    test('findPaths discards cached sockets when listing fails', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      vi.mocked(process.exec).mockRejectedValueOnce(new Error('listing failed'));
      expect(await finder.findPaths()).toEqual([]);

      const newSocketPath = '/tmp/podman/restarted-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce(machineListResult)
        .mockResolvedValueOnce({ command: 'podman', stdout: newSocketPath, stderr: '' });
      expect(await finder.findPaths()).toEqual([newSocketPath]);
    });

    test('findPaths prefers the shared socket and refreshes the fallback if it disappears again', async () => {
      expect(await finder.findPaths()).toEqual([machineSocketPath]);
      vi.mocked(access).mockResolvedValueOnce(undefined);
      expect(await finder.findPaths()).toEqual(['/home/user/.local/share/containers/podman/machine/podman.sock']);
      expect(process.exec).toHaveBeenCalledTimes(2);

      const newSocketPath = '/tmp/podman/restarted-api.sock';
      vi.mocked(process.exec)
        .mockResolvedValueOnce(machineListResult)
        .mockResolvedValueOnce({ command: 'podman', stdout: newSocketPath, stderr: '' });
      expect(await finder.findPaths()).toEqual([newSocketPath]);
    });
  });
});
