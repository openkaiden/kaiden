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

import type { NetworkInterfaceInfo } from 'node:os';
import { networkInterfaces } from 'node:os';

import { env } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ContainerHostResolver } from './container-host-resolver';

vi.mock(import('node:os'));
vi.mock(import('@openkaiden/api'));

describe('ContainerHostResolver', () => {
  const loopback: NetworkInterfaceInfo = {
    address: '127.0.0.1',
    netmask: '255.0.0.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: true,
    cidr: '127.0.0.1/8',
  };
  const ethernetIPv4: NetworkInterfaceInfo = {
    address: '192.168.1.100',
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:11:22:33:44:55',
    internal: false,
    cidr: '192.168.1.100/24',
  };
  const ethernetIPv6: NetworkInterfaceInfo = {
    address: 'fe80::1',
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac: '00:11:22:33:44:55',
    internal: false,
    cidr: 'fe80::1/64',
    scopeid: 0,
  };

  let resolver: ContainerHostResolver;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(env).isWindows = false;
    resolver = new ContainerHostResolver();
  });

  test('should return localhost on macOS/Linux', () => {
    expect(resolver.getReachableHost()).toBe('localhost');
    expect(networkInterfaces).not.toHaveBeenCalled();
  });

  test('should return the first non-internal IPv4 address on Windows', () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(networkInterfaces).mockReturnValue({
      lo: [loopback],
      eth0: [ethernetIPv4],
    });

    expect(resolver.getReachableHost()).toBe('192.168.1.100');
  });

  test('should wrap an IPv6 address in brackets on Windows', () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(networkInterfaces).mockReturnValue({
      eth0: [ethernetIPv6],
    });

    expect(resolver.getReachableHost()).toBe('[fe80::1]');
  });

  test('should fall back to localhost on Windows when only internal interfaces exist', () => {
    vi.mocked(env).isWindows = true;
    vi.mocked(networkInterfaces).mockReturnValue({
      lo: [loopback],
    });

    expect(resolver.getReachableHost()).toBe('localhost');
  });
});
