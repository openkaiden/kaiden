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

import { join } from 'node:path';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

import { OpenshellGatewayConfig } from './openshell-gateway-config.js';

vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));

function gateway(overrides: Partial<GatewayInfo> = {}): GatewayInfo {
  return { canStop: false, name: 'kaiden-local', endpoint: 'http://127.0.0.1:17670', active: true, ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OpenshellGatewayConfig', () => {
  describe('buildConnectOptions', () => {
    test('returns gateway URL only for http endpoints', async () => {
      const config = new OpenshellGatewayConfig();

      const options = await config.buildConnectOptions(gateway());

      expect(options).toStrictEqual({ gateway: 'http://127.0.0.1:17670' });
    });

    test('loads mTLS certs for https endpoints', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '/test/config');
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile)
        .mockResolvedValueOnce(Buffer.from('ca-data'))
        .mockResolvedValueOnce(Buffer.from('cert-data'))
        .mockResolvedValueOnce(Buffer.from('key-data'));

      const config = new OpenshellGatewayConfig();
      const gw = gateway({ name: 'remote-gw', endpoint: 'https://gw.example.com', auth: 'mtls' });

      const options = await config.buildConnectOptions(gw);

      const expectedMtlsDir = join('/test/config', 'openshell', 'gateways', 'remote-gw', 'mtls');
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(join(expectedMtlsDir, 'ca.crt'));
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(join(expectedMtlsDir, 'tls.crt'));
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(join(expectedMtlsDir, 'tls.key'));
      expect(options).toStrictEqual({
        gateway: 'https://gw.example.com',
        caCert: Buffer.from('ca-data'),
        clientCert: Buffer.from('cert-data'),
        clientKey: Buffer.from('key-data'),
      });
    });

    test('passes undefined certs when mTLS files are missing', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '/test/config');
      const { readFile } = await import('node:fs/promises');
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      vi.mocked(readFile).mockRejectedValue(enoent);

      const config = new OpenshellGatewayConfig();
      const gw = gateway({ name: 'no-certs', endpoint: 'https://gw.example.com' });

      const options = await config.buildConnectOptions(gw);

      expect(options).toStrictEqual({
        gateway: 'https://gw.example.com',
        caCert: undefined,
        clientCert: undefined,
        clientKey: undefined,
      });
    });

    test('propagates non-ENOENT cert read errors', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '/test/config');
      const { readFile } = await import('node:fs/promises');
      const permError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      vi.mocked(readFile).mockRejectedValue(permError);

      const config = new OpenshellGatewayConfig();
      const gw = gateway({ name: 'bad-perms', endpoint: 'https://gw.example.com' });

      await expect(config.buildConnectOptions(gw)).rejects.toThrow(/EACCES/);
    });

    test('respects XDG_CONFIG_HOME', async () => {
      const { readFile } = await import('node:fs/promises');
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      vi.mocked(readFile).mockRejectedValue(enoent);
      vi.stubEnv('XDG_CONFIG_HOME', '/custom/config');

      const config = new OpenshellGatewayConfig();
      const gw = gateway({ name: 'xdg-gw', endpoint: 'https://gw.example.com' });

      await config.buildConnectOptions(gw);

      const expectedMtlsDir = join('/custom/config', 'openshell', 'gateways', 'xdg-gw', 'mtls');
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(join(expectedMtlsDir, 'ca.crt'));

      vi.unstubAllEnvs();
    });
  });
});
