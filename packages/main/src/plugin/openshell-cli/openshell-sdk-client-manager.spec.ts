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

import { OpenShellClient } from '@nvidia/openshell-sdk';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { GatewayMetadata } from '/@api/openshell-gateway-info.js';

import type { OpenshellGatewayConfig } from './openshell-gateway-config.js';
import { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

vi.mock(import('@nvidia/openshell-sdk'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-manager.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-config.js'));

const mockConnect = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();

  vi.mocked(OpenShellClient.connect).mockImplementation(mockConnect);
  mockConnect.mockResolvedValue({ sandbox: {}, raw: {}, transport: {} });
});

function metadata(overrides: Partial<GatewayMetadata> = {}): GatewayMetadata {
  return {
    name: 'kaiden-local',
    gateway_endpoint: 'http://127.0.0.1:17670',
    is_remote: false,
    gateway_port: 17670,
    ...overrides,
  };
}

function createSdkClient(
  opts: {
    getGateway?: (name: string) => Promise<GatewayMetadata>;
  } = {},
  buildConnectOptions?: OpenshellGatewayConfig['buildConnectOptions'],
): OpenshellSdkClientManager {
  const gatewayManager = {
    getGateway: opts.getGateway ?? vi.fn().mockImplementation(async (name: string) => metadata({ name })),
  } as never;
  const gatewayConfig = {
    buildConnectOptions:
      buildConnectOptions ??
      vi.fn().mockImplementation(async (gw: { name: string; endpoint: string }) => ({ gateway: gw.endpoint })),
  } as never;
  return new OpenshellSdkClientManager(gatewayManager, gatewayConfig);
}

describe('OpenshellSdkClientManager', () => {
  describe('getClient', () => {
    test('connects with options from gateway config', async () => {
      const sdkClient = createSdkClient();

      await sdkClient.getClient('kaiden-local');

      expect(mockConnect).toHaveBeenCalledWith({ gateway: 'http://127.0.0.1:17670' });
    });

    test('delegates connect options assembly to OpenshellGatewayConfig', async () => {
      const mockBuild = vi.fn().mockResolvedValue({
        gateway: 'https://gw.example.com',
        caCert: Buffer.from('ca'),
        clientCert: Buffer.from('cert'),
        clientKey: Buffer.from('key'),
      });
      const remoteMeta = metadata({ name: 'remote', gateway_endpoint: 'https://gw.example.com', is_remote: true });
      const sdkClient = createSdkClient(
        {
          getGateway: vi.fn().mockResolvedValue(remoteMeta),
        },
        mockBuild,
      );

      await sdkClient.getClient('remote');

      expect(mockBuild).toHaveBeenCalledWith({ name: 'remote', endpoint: 'https://gw.example.com' });
      expect(mockConnect).toHaveBeenCalledWith({
        gateway: 'https://gw.example.com',
        caCert: Buffer.from('ca'),
        clientCert: Buffer.from('cert'),
        clientKey: Buffer.from('key'),
      });
    });

    test('caches client for same gateway name', async () => {
      const sdkClient = createSdkClient();

      const first = await sdkClient.getClient('kaiden-local');
      const second = await sdkClient.getClient('kaiden-local');

      expect(first).toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    describe('endpoint changes', () => {
      test.each([
        [17671, 17670],
        [17670, 17672],
      ])('replaces the cached client when the port changes from %s to %s', async (oldPort, newPort) => {
        const oldEndpoint = `http://127.0.0.1:${oldPort}`;
        const newEndpoint = `http://127.0.0.1:${newPort}`;
        const sdkClient = createSdkClient({
          getGateway: vi
            .fn()
            .mockResolvedValueOnce(metadata({ gateway_endpoint: oldEndpoint, gateway_port: oldPort }))
            .mockResolvedValue(metadata({ gateway_endpoint: newEndpoint, gateway_port: newPort })),
        });
        const oldClient = { id: 'old' };
        const newClient = { id: 'new' };
        mockConnect.mockResolvedValueOnce(oldClient).mockResolvedValueOnce(newClient);

        expect(await sdkClient.getClient('kaiden-local')).toBe(oldClient);
        const [first, second] = await Promise.all([
          sdkClient.getClient('kaiden-local'),
          sdkClient.getClient('kaiden-local'),
        ]);

        expect(first).toBe(newClient);
        expect(second).toBe(newClient);
        expect(await sdkClient.getClient('kaiden-local')).toBe(newClient);
        expect(mockConnect).toHaveBeenNthCalledWith(1, { gateway: oldEndpoint });
        expect(mockConnect).toHaveBeenNthCalledWith(2, { gateway: newEndpoint });
        expect(mockConnect).toHaveBeenCalledTimes(2);
      });

      test('keeps the replacement cached when the old connection fails later', async () => {
        const sdkClient = createSdkClient({
          getGateway: vi
            .fn()
            .mockResolvedValueOnce(metadata({ gateway_endpoint: 'http://127.0.0.1:17671', gateway_port: 17671 }))
            .mockResolvedValue(metadata()),
        });
        const oldConnection = Promise.withResolvers<OpenShellClient>();
        vi.mocked(OpenShellClient.connect).mockReturnValueOnce(oldConnection.promise);
        const oldRequest = sdkClient.getClient('kaiden-local');
        await vi.waitFor(() => expect(OpenShellClient.connect).toHaveBeenCalledOnce());

        const replacement = await sdkClient.getClient('kaiden-local');
        oldConnection.reject(new Error('old endpoint unavailable'));
        await expect(oldRequest).rejects.toThrow('old endpoint unavailable');

        expect(await sdkClient.getClient('kaiden-local')).toBe(replacement);
        expect(OpenShellClient.connect).toHaveBeenCalledTimes(2);
        expect(OpenShellClient.connect).toHaveBeenLastCalledWith({ gateway: 'http://127.0.0.1:17670' });
      });
    });

    test('concurrent calls for same gateway share a single connection attempt', async () => {
      const sdkClient = createSdkClient();

      const [first, second] = await Promise.all([
        sdkClient.getClient('kaiden-local'),
        sdkClient.getClient('kaiden-local'),
      ]);

      expect(first).toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    test('evicts cached promise when connect rejects', async () => {
      const sdkClient = createSdkClient();
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));

      await expect(sdkClient.getClient('kaiden-local')).rejects.toThrow('connection refused');

      mockConnect.mockResolvedValueOnce({ sandbox: {}, raw: {}, transport: {} });
      await expect(sdkClient.getClient('kaiden-local')).resolves.toBeDefined();
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    test('creates separate clients for different gateways', async () => {
      const localMeta = metadata({ name: 'local' });
      const remoteMeta = metadata({ name: 'remote', gateway_endpoint: 'http://10.0.0.1:17670' });
      const sdkClient = createSdkClient({
        getGateway: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'local') return localMeta;
          if (name === 'remote') return remoteMeta;
          throw new Error(`Not found: ${name}`);
        }),
      });

      mockConnect.mockResolvedValueOnce({ id: 'client-local' }).mockResolvedValueOnce({ id: 'client-remote' });

      const first = await sdkClient.getClient('local');
      const second = await sdkClient.getClient('remote');

      expect(first).not.toBe(second);
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    test('throws when named gateway is not found', async () => {
      const sdkClient = createSdkClient({
        getGateway: vi.fn().mockRejectedValue(new Error(`No metadata found for gateway 'missing'`)),
      });

      await expect(sdkClient.getClient('missing')).rejects.toThrow(/gateway 'missing'/i);
    });
  });

  describe('invalidate', () => {
    test('clears cache for a specific gateway', async () => {
      const sdkClient = createSdkClient();

      await sdkClient.getClient('kaiden-local');
      sdkClient.invalidate('kaiden-local');
      await sdkClient.getClient('kaiden-local');

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    test('clears entire cache when no name is given', async () => {
      const sdkClient = createSdkClient();

      await sdkClient.getClient('kaiden-local');
      sdkClient.invalidate();
      await sdkClient.getClient('kaiden-local');

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('dispose', () => {
    test('clears cache on dispose', async () => {
      const sdkClient = createSdkClient();

      await sdkClient.getClient('kaiden-local');
      sdkClient.dispose();
      await sdkClient.getClient('kaiden-local');

      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });
});
