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

import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:net';
import { networkInterfaces } from 'node:os';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { NetworkHelper } from './network-helper';

vi.mock(import('node:net'));
vi.mock(import('node:os'));

// ports/addresses that fail to bind, with the error code to emit
let bindErrors: Map<string, string>;
let listenCalls: Array<{ port: number; address: string }>;
let closeCount: number;

class FakeServer extends EventEmitter {
  listen(port: number, address: string): this {
    listenCalls.push({ port, address });
    const code = bindErrors.get(`${address}:${port}`) ?? bindErrors.get(`*:${port}`) ?? bindErrors.get('*');
    if (code) {
      this.emit('error', Object.assign(new Error(code), { code }));
    } else {
      this.emit('listening');
    }
    return this;
  }

  close(callback: () => void): this {
    closeCount++;
    callback();
    return this;
  }
}

let helper: NetworkHelper;

beforeEach(() => {
  vi.resetAllMocks();
  bindErrors = new Map();
  listenCalls = [];
  closeCount = 0;
  vi.mocked(createServer).mockImplementation(() => new FakeServer() as unknown as Server);
  vi.mocked(networkInterfaces).mockReturnValue({
    en0: [
      { address: '192.168.1.10', family: 'IPv4', netmask: '', mac: '', internal: false, cidr: '192.168.1.10/24' },
      { address: 'fe80::1', family: 'IPv6', netmask: '', mac: '', internal: false, cidr: 'fe80::1/64', scopeid: 0 },
    ],
  });
  helper = new NetworkHelper();
});

describe('isPortFree', () => {
  test('returns true and closes servers when port binds on every IPv4 address', async () => {
    await expect(helper.isPortFree(5000)).resolves.toBe(true);

    expect(listenCalls).toEqual([
      { port: 5000, address: 'localhost' },
      { port: 5000, address: '0.0.0.0' },
      { port: 5000, address: '192.168.1.10' },
    ]);
    expect(closeCount).toBe(3);
  });

  test.each(['localhost', '0.0.0.0', '192.168.1.10'])('returns false when port is in use on %s', async address => {
    bindErrors.set(`${address}:5000`, 'EADDRINUSE');

    await expect(helper.isPortFree(5000)).resolves.toBe(false);
  });

  test('throws with context on errors other than EADDRINUSE', async () => {
    bindErrors.set('localhost:80', 'EACCES');

    await expect(helper.isPortFree(80)).rejects.toThrow('Failed to check port 80 on localhost: EACCES');
  });
});

describe('getFreeRandomPort', () => {
  test('returns a free port within the default range', async () => {
    const port = await helper.getFreeRandomPort();

    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThan(65536);
  });

  test('returns a port within the requested range', async () => {
    await expect(helper.getFreeRandomPort({ min: 6000, max: 6001 })).resolves.toBe(6000);
  });

  test('skips busy ports', async () => {
    bindErrors.set('*:7000', 'EADDRINUSE');

    await expect(helper.getFreeRandomPort({ min: 7000, max: 7002 })).resolves.toBe(7001);
  });

  test('skips excluded ports without checking them', async () => {
    await expect(helper.getFreeRandomPort({ min: 8000, max: 8002, exclude: [8000] })).resolves.toBe(8001);

    expect(listenCalls.some(c => c.port === 8000)).toBe(false);
  });

  test('throws after maxAttempts when no free port is found', async () => {
    bindErrors.set('*', 'EADDRINUSE');

    await expect(helper.getFreeRandomPort({ min: 9000, max: 9010, maxAttempts: 3 })).rejects.toThrow(
      'Unable to find a free port in [9000, 9010) after 3 attempts',
    );
    expect(listenCalls).toHaveLength(3);
  });

  test('propagates unexpected bind errors', async () => {
    bindErrors.set('*', 'EACCES');

    await expect(helper.getFreeRandomPort({ min: 9000, max: 9001 })).rejects.toThrow(
      'Failed to check port 9000 on localhost: EACCES',
    );
  });
});

describe('convertHost', () => {
  test.each([
    ['localhost', 'host.docker.internal'],
    ['localhost/v1', 'host.docker.internal'],
    ['api.example.com', 'api.example.com'],
    ['api.example.com/path', 'api.example.com'],
    ['127.0.0.1', '127.0.0.1'],
  ])('converts %s to %s', (host, expected) => {
    expect(helper.convertHost(host)).toBe(expected);
  });
});
