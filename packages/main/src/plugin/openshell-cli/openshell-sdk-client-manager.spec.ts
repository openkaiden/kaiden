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

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

import type { OpenshellGatewayConfig } from './openshell-gateway-config.js';
import { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

vi.mock(import('@nvidia/openshell-sdk'));
vi.mock(import('/@/plugin/openshell-cli/openshell-cli.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-config.js'));

const mockConnect = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();

  const sdk = await import('@nvidia/openshell-sdk');
  vi.mocked(sdk.OpenShellClient.connect).mockImplementation(mockConnect);
  mockConnect.mockResolvedValue({ sandbox: {}, raw: {}, transport: {} });
});

function gateway(overrides: Partial<GatewayInfo> = {}): GatewayInfo {
  return {
    name: 'kaiden-local',
    endpoint: 'http://127.0.0.1:17670',
    active: true,
    ...overrides,
  };
}

function createSdkClient(
  listGateways: () => Promise<GatewayInfo[]>,
  buildConnectOptions?: OpenshellGatewayConfig['buildConnectOptions'],
): OpenshellSdkClientManager {
  const openshellCli = { listGateways } as never;
  const gatewayConfig = {
    buildConnectOptions:
      buildConnectOptions ?? vi.fn().mockImplementation(async (gw: GatewayInfo) => ({ gateway: gw.endpoint })),
  } as never;
  return new OpenshellSdkClientManager(openshellCli, gatewayConfig);
}

describe('OpenshellSdkClientManager', () => {
  describe('getClient', () => {
    test('connects with options from gateway config', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);

      await sdkClient.getClient();

      expect(mockConnect).toHaveBeenCalledWith({ gateway: 'http://127.0.0.1:17670' });
    });

    test('delegates connect options assembly to OpenshellGatewayConfig', async () => {
      const mockBuild = vi.fn().mockResolvedValue({
        gateway: 'https://gw.example.com',
        caCert: Buffer.from('ca'),
        clientCert: Buffer.from('cert'),
        clientKey: Buffer.from('key'),
      });
      const gw = gateway({ name: 'remote', endpoint: 'https://gw.example.com' });
      const sdkClient = createSdkClient(async () => [gw], mockBuild);

      await sdkClient.getClient('remote');

      expect(mockBuild).toHaveBeenCalledWith(gw);
      expect(mockConnect).toHaveBeenCalledWith({
        gateway: 'https://gw.example.com',
        caCert: Buffer.from('ca'),
        clientCert: Buffer.from('cert'),
        clientKey: Buffer.from('key'),
      });
    });

    test('caches client for same gateway name', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);

      const first = await sdkClient.getClient();
      const second = await sdkClient.getClient();

      expect(first).toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    test('concurrent calls for same gateway share a single connection attempt', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);

      const [first, second] = await Promise.all([sdkClient.getClient(), sdkClient.getClient()]);

      expect(first).toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    test('evicts cached promise when connect rejects', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));

      await expect(sdkClient.getClient()).rejects.toThrow('connection refused');

      mockConnect.mockResolvedValueOnce({ sandbox: {}, raw: {}, transport: {} });
      await expect(sdkClient.getClient()).resolves.toBeDefined();
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    test('creates separate clients for different gateways', async () => {
      const localGw = gateway({ name: 'local', endpoint: 'http://127.0.0.1:17670', active: true });
      const remoteGw = gateway({ name: 'remote', endpoint: 'http://10.0.0.1:17670', active: false });
      const sdkClient = createSdkClient(async () => [localGw, remoteGw]);

      mockConnect.mockResolvedValueOnce({ id: 'client-local' }).mockResolvedValueOnce({ id: 'client-remote' });

      const first = await sdkClient.getClient('local');
      const second = await sdkClient.getClient('remote');

      expect(first).not.toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    test('selects active gateway when no name is provided', async () => {
      const inactive = gateway({ name: 'inactive', active: false });
      const active = gateway({ name: 'active-gw', endpoint: 'http://127.0.0.1:17670', active: true });
      const sdkClient = createSdkClient(async () => [inactive, active]);

      await sdkClient.getClient();

      expect(mockConnect).toHaveBeenCalledWith({ gateway: 'http://127.0.0.1:17670' });
    });

    test('selects sole gateway when none is active', async () => {
      const gw = gateway({ active: false });
      const sdkClient = createSdkClient(async () => [gw]);

      await sdkClient.getClient();

      expect(mockConnect).toHaveBeenCalledWith({ gateway: 'http://127.0.0.1:17670' });
    });

    test('throws when named gateway is not found', async () => {
      const sdkClient = createSdkClient(async () => [gateway()]);

      await expect(sdkClient.getClient('missing')).rejects.toThrow(/gateway 'missing' not found/i);
    });

    test('throws when no gateways are registered', async () => {
      const sdkClient = createSdkClient(async () => []);

      await expect(sdkClient.getClient()).rejects.toThrow(/no openshell gateways registered/i);
    });

    test('throws when multiple gateways exist but none is active', async () => {
      const gw1 = gateway({ name: 'gw1', active: false });
      const gw2 = gateway({ name: 'gw2', active: false });
      const sdkClient = createSdkClient(async () => [gw1, gw2]);

      await expect(sdkClient.getClient()).rejects.toThrow(/multiple.*none is active/i);
    });
  });

  describe('invalidate', () => {
    test('clears cache for a specific gateway', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);

      await sdkClient.getClient();
      sdkClient.invalidate('kaiden-local');
      await sdkClient.getClient();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    test('clears entire cache when no name is given', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);

      await sdkClient.getClient();
      sdkClient.invalidate();
      await sdkClient.getClient();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('dispose', () => {
    test('clears cache on dispose', async () => {
      const gw = gateway();
      const sdkClient = createSdkClient(async () => [gw]);

      await sdkClient.getClient();
      sdkClient.dispose();
      await sdkClient.getClient();

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });
});
