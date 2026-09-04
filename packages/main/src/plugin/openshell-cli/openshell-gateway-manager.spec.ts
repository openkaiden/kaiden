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
import { join } from 'node:path';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { GatewayMetadata } from '/@api/openshell-gateway-info.js';

import type { OpenshellGatewayConfig } from './openshell-gateway-config.js';
import { OpenshellGatewayManager } from './openshell-gateway-manager.js';
import type { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('node:http2'));

const USER_CONFIG = '/home/testuser/.config';
const USER_GATEWAYS_DIR = join(USER_CONFIG, 'openshell', 'gateways');
const SYSTEM_CONFIG_DIR = '/etc/openshell';
const SYSTEM_GATEWAYS_DIR = join(SYSTEM_CONFIG_DIR, 'gateways');

function validMetadata(overrides: Partial<GatewayMetadata> = {}): GatewayMetadata {
  return {
    name: 'test-gw',
    gateway_endpoint: 'http://127.0.0.1:17670',
    is_remote: false,
    gateway_port: 17670,
    ...overrides,
  };
}

const gatewayConfig = {
  buildConnectOptions: vi.fn().mockResolvedValue({ gateway: 'http://127.0.0.1:17670' }),
} as unknown as OpenshellGatewayConfig;

const sdkClientManager = {
  getClient: vi.fn(),
} as unknown as OpenshellSdkClientManager;

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining & 0x7f);
  return Buffer.from(bytes);
}

function encodeString(fieldNumber: number, value: string): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const content = Buffer.from(value, 'utf-8');
  const len = encodeVarint(content.length);
  return Buffer.concat([tag, len, content]);
}

function encodeMessage(fieldNumber: number, content: Buffer): Buffer {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const len = encodeVarint(content.length);
  return Buffer.concat([tag, len, content]);
}

function encodeGatewayInfoResponse(opts: {
  status: number;
  gatewayVersion?: string;
  drivers?: { name: string; driverName: string; driverVersion?: string }[];
}): Buffer {
  const parts: Buffer[] = [];
  if (opts.status) parts.push(Buffer.concat([encodeVarint((1 << 3) | 0), encodeVarint(opts.status)]));
  if (opts.gatewayVersion) parts.push(encodeString(2, opts.gatewayVersion));
  for (const d of opts.drivers ?? []) {
    const caps = Buffer.concat([
      encodeString(1, d.driverName),
      ...(d.driverVersion ? [encodeString(2, d.driverVersion)] : []),
    ]);
    const driver = Buffer.concat([encodeString(1, d.name), encodeMessage(2, caps)]);
    parts.push(encodeMessage(3, driver));
  }
  const msg = Buffer.concat(parts);
  const frame = Buffer.alloc(5 + msg.length);
  frame.writeUInt8(0, 0);
  frame.writeUInt32BE(msg.length, 1);
  msg.copy(frame, 5);
  return frame;
}

async function mockGrpcResponse(
  statusCode: number,
  grpcBody: Buffer,
  trailers?: Record<string, string>,
): Promise<void> {
  const { connect } = await import('node:http2');

  vi.mocked(connect).mockImplementation(() => {
    const session = new EventEmitter() as ReturnType<typeof connect>;
    session.close = vi.fn();
    session.destroy = vi.fn() as never;

    session.request = vi.fn().mockImplementation(() => {
      const stream = new EventEmitter();
      Object.assign(stream, { write: vi.fn(), end: vi.fn() });

      process.nextTick(() => {
        stream.emit('response', { ':status': statusCode });
        stream.emit('data', grpcBody);
        if (trailers) stream.emit('trailers', trailers);
        stream.emit('end');
      });

      return stream;
    });

    return session;
  });
}

let manager: OpenshellGatewayManager;

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('XDG_CONFIG_HOME', USER_CONFIG);
  vi.mocked(gatewayConfig.buildConnectOptions).mockResolvedValue({ gateway: 'http://127.0.0.1:17670' });
  manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);
});

describe('OpenshellGatewayManager', () => {
  describe('listGateways', () => {
    test('lists gateways from user directory', async () => {
      const { readdir, readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      vi.mocked(readdir)
        .mockResolvedValueOnce(['my-gw'] as unknown as never[])
        .mockRejectedValueOnce(new Error());
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'my-gw' })));

      const gateways = await manager.listGateways();

      expect(gateways).toEqual([{ metadata: validMetadata({ name: 'my-gw' }), source: 'user' }]);
      expect(readdir).toHaveBeenCalledWith(USER_GATEWAYS_DIR);
    });

    test('lists gateways from both user and system directories', async () => {
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', SYSTEM_CONFIG_DIR);
      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);
      const { readdir, readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      vi.mocked(readdir)
        .mockResolvedValueOnce(['user-gw'] as unknown as never[])
        .mockResolvedValueOnce(['system-gw'] as unknown as never[]);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'user-gw' })))
        .mockResolvedValueOnce(
          JSON.stringify(validMetadata({ name: 'system-gw', gateway_endpoint: 'https://system.example.com' })),
        );

      const gateways = await manager.listGateways();

      expect(gateways).toHaveLength(2);
      expect(gateways[0]!.source).toBe('system');
      expect(gateways[0]!.metadata.name).toBe('system-gw');
      expect(gateways[1]!.source).toBe('user');
      expect(gateways[1]!.metadata.name).toBe('user-gw');
    });

    test('user gateways take precedence over system gateways with the same name', async () => {
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', SYSTEM_CONFIG_DIR);
      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);
      const { readdir, readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      vi.mocked(readdir)
        .mockResolvedValueOnce(['shared-gw'] as unknown as never[])
        .mockResolvedValueOnce(['shared-gw'] as unknown as never[]);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValueOnce(
        JSON.stringify(validMetadata({ name: 'shared-gw', gateway_endpoint: 'http://user-endpoint' })),
      );

      const gateways = await manager.listGateways();

      expect(gateways).toHaveLength(1);
      expect(gateways[0]!.source).toBe('user');
      expect(gateways[0]!.metadata.gateway_endpoint).toBe('http://user-endpoint');
    });

    test('returns empty list when no gateways exist', async () => {
      const { readdir } = await import('node:fs/promises');
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      const gateways = await manager.listGateways();

      expect(gateways).toEqual([]);
    });

    test('skips entries with invalid names', async () => {
      const { readdir, readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      vi.mocked(readdir)
        .mockResolvedValueOnce(['valid-gw', '..', '.hidden'] as unknown as never[])
        .mockRejectedValueOnce(new Error());
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'valid-gw' })));

      const gateways = await manager.listGateways();

      expect(gateways).toHaveLength(1);
      expect(gateways[0]!.metadata.name).toBe('valid-gw');
    });

    test('skips entries without a metadata.json file', async () => {
      const { readdir } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      vi.mocked(readdir)
        .mockResolvedValueOnce(['no-meta'] as unknown as never[])
        .mockRejectedValueOnce(new Error());
      vi.mocked(existsSync).mockReturnValue(false);

      const gateways = await manager.listGateways();

      expect(gateways).toEqual([]);
    });

    test('does not list system gateways on win32', async () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', '');

      try {
        const { readdir, readFile } = await import('node:fs/promises');
        const { existsSync } = await import('node:fs');
        vi.mocked(readdir).mockResolvedValueOnce(['win-gw'] as unknown as never[]);
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'win-gw' })));

        const gateways = await manager.listGateways();

        expect(gateways).toHaveLength(1);
        expect(readdir).toHaveBeenCalledTimes(1);
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      }
    });
  });

  describe('getGateway', () => {
    test('returns metadata from user directory', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'my-gw' })));

      const result = await manager.getGateway('my-gw');

      expect(result).toEqual(validMetadata({ name: 'my-gw' }));
      expect(readFile).toHaveBeenCalledWith(join(USER_GATEWAYS_DIR, 'my-gw', 'metadata.json'), 'utf-8');
    });

    test('falls back to system directory when not found in user', async () => {
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', SYSTEM_CONFIG_DIR);
      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'system-gw' })));

      const result = await manager.getGateway('system-gw');

      expect(result).toEqual(validMetadata({ name: 'system-gw' }));
      expect(readFile).toHaveBeenCalledWith(join(SYSTEM_GATEWAYS_DIR, 'system-gw', 'metadata.json'), 'utf-8');
    });

    test('throws when gateway is not found anywhere', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(manager.getGateway('missing')).rejects.toThrow(/No metadata found for gateway 'missing'/);
    });

    test('rejects invalid gateway names', async () => {
      await expect(manager.getGateway('..')).rejects.toThrow(/Invalid gateway name/);
      await expect(manager.getGateway('foo/bar')).rejects.toThrow(/Invalid gateway name/);
      await expect(manager.getGateway('')).rejects.toThrow(/Invalid gateway name/);
    });
  });

  describe('addGateway', () => {
    test('creates gateway directory and writes metadata', async () => {
      const { existsSync } = await import('node:fs');
      const { mkdir, writeFile } = await import('node:fs/promises');
      vi.mocked(existsSync).mockReturnValue(false);

      const metadata = validMetadata({ name: 'new-gw' });
      await manager.addGateway('new-gw', metadata);

      expect(mkdir).toHaveBeenCalledWith(join(USER_GATEWAYS_DIR, 'new-gw'), { recursive: true, mode: 0o700 });
      expect(writeFile).toHaveBeenCalledWith(
        join(USER_GATEWAYS_DIR, 'new-gw', 'metadata.json'),
        JSON.stringify(metadata, undefined, 2),
        'utf-8',
      );
    });

    test('throws when a user gateway with the same name already exists', async () => {
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(true);

      await expect(manager.addGateway('existing', validMetadata({ name: 'existing' }))).rejects.toThrow(
        /already exists/,
      );
    });

    test('allows adding a user gateway that shadows a system gateway', async () => {
      const { existsSync } = await import('node:fs');
      const { mkdir, writeFile } = await import('node:fs/promises');
      vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);

      const metadata = validMetadata({ name: 'system-override' });
      await manager.addGateway('system-override', metadata);

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    test('throws when metadata.name does not match the gateway name', async () => {
      await expect(manager.addGateway('foo', validMetadata({ name: 'bar' }))).rejects.toThrow(
        /does not match gateway name/,
      );
    });

    test('rejects invalid gateway names', async () => {
      await expect(manager.addGateway('..', validMetadata())).rejects.toThrow(/Invalid gateway name/);
    });
  });

  describe('removeGateway', () => {
    test('removes user gateway metadata file', async () => {
      const { existsSync } = await import('node:fs');
      const { rm, readFile } = await import('node:fs/promises');
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      await manager.removeGateway('old-gw');

      expect(rm).toHaveBeenCalledWith(join(USER_GATEWAYS_DIR, 'old-gw', 'metadata.json'), { force: true });
    });

    test('clears active gateway when removing the active one', async () => {
      const { existsSync } = await import('node:fs');
      const { rm, readFile } = await import('node:fs/promises');
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readFile).mockResolvedValueOnce('old-gw');

      await manager.removeGateway('old-gw');

      expect(rm).toHaveBeenCalledWith(join(USER_GATEWAYS_DIR, 'old-gw', 'metadata.json'), { force: true });
      expect(rm).toHaveBeenCalledWith(join(USER_CONFIG, 'openshell', 'active_gateway'), { force: true });
    });

    test('throws when trying to remove a system gateway', async () => {
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', SYSTEM_CONFIG_DIR);
      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);

      await expect(manager.removeGateway('system-gw')).rejects.toThrow(/installed by the system/);
    });

    test('throws when gateway does not exist', async () => {
      const { existsSync } = await import('node:fs');
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(manager.removeGateway('nonexistent')).rejects.toThrow(/No gateway metadata found/);
    });

    test('rejects invalid gateway names', async () => {
      await expect(manager.removeGateway('foo/bar')).rejects.toThrow(/Invalid gateway name/);
    });
  });

  describe('getActiveGateway', () => {
    test('reads active gateway name from user config', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce('my-active\n');

      const active = await manager.getActiveGateway();

      expect(active).toBe('my-active');
      expect(readFile).toHaveBeenCalledWith(join(USER_CONFIG, 'openshell', 'active_gateway'), 'utf-8');
    });

    test('falls back to system active gateway when user has none', async () => {
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', SYSTEM_CONFIG_DIR);
      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce('system-active');

      const active = await manager.getActiveGateway();

      expect(active).toBe('system-active');
    });

    test('returns undefined when no active gateway is set', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      const active = await manager.getActiveGateway();

      expect(active).toBeUndefined();
    });

    test('returns undefined when active gateway file contains an invalid name', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce('..');

      const active = await manager.getActiveGateway();

      expect(active).toBeUndefined();
    });
  });

  describe('setActiveGateway', () => {
    test('writes the active gateway name to user config', async () => {
      const { readFile, mkdir, writeFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'target-gw' })));

      await manager.setActiveGateway('target-gw');

      expect(mkdir).toHaveBeenCalledWith(join(USER_CONFIG, 'openshell'), { recursive: true, mode: 0o700 });
      expect(writeFile).toHaveBeenCalledWith(join(USER_CONFIG, 'openshell', 'active_gateway'), 'target-gw', 'utf-8');
    });

    test('throws when the target gateway does not exist', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(manager.setActiveGateway('missing')).rejects.toThrow(/No metadata found for gateway 'missing'/);
    });

    test('rejects invalid gateway names', async () => {
      await expect(manager.setActiveGateway('')).rejects.toThrow(/Invalid gateway name/);
    });
  });

  describe('getGatewayInfo', () => {
    test('makes a gRPC call and returns parsed runtime info', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'my-gw' })));

      const grpcBody = encodeGatewayInfoResponse({
        status: 1,
        gatewayVersion: '0.0.69',
        drivers: [{ name: 'docker', driverName: 'docker', driverVersion: '1.0' }],
      });
      await mockGrpcResponse(200, grpcBody);

      const result = await manager.getGatewayInfo('my-gw');

      expect(gatewayConfig.buildConnectOptions).toHaveBeenCalledWith({
        name: 'my-gw',
        endpoint: 'http://127.0.0.1:17670',
      });
      expect(result.status).toBe('healthy');
      expect(result.compute_drivers).toHaveLength(1);
      expect(result.compute_drivers[0]!.capabilities.driver_name).toBe('docker');
    });

    test('decodes degraded status from protobuf enum', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'gw' })));

      await mockGrpcResponse(200, encodeGatewayInfoResponse({ status: 2 }));

      const result = await manager.getGatewayInfo('gw');

      expect(result.status).toBe('degraded');
    });

    test('resolves active gateway when no name is provided', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile)
        .mockResolvedValueOnce('active-gw')
        .mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'active-gw' })));

      await mockGrpcResponse(200, encodeGatewayInfoResponse({ status: 1 }));

      await manager.getGatewayInfo();

      expect(gatewayConfig.buildConnectOptions).toHaveBeenCalledWith({
        name: 'active-gw',
        endpoint: 'http://127.0.0.1:17670',
      });
    });

    test('throws on HTTP error response', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'gw' })));

      await mockGrpcResponse(401, Buffer.alloc(0));

      await expect(manager.getGatewayInfo('gw')).rejects.toThrow(/HTTP 401/);
    });

    test('throws on non-zero grpc-status trailer', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'gw' })));

      await mockGrpcResponse(200, Buffer.alloc(0), { 'grpc-status': '13', 'grpc-message': 'internal%20error' });

      await expect(manager.getGatewayInfo('gw')).rejects.toThrow(/gRPC error \(status 13\): internal error/);
    });

    test('handles malformed percent-encoding in grpc-message trailer', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'gw' })));

      await mockGrpcResponse(200, Buffer.alloc(0), { 'grpc-status': '2', 'grpc-message': 'bad%ZZencoding' });

      await expect(manager.getGatewayInfo('gw')).rejects.toThrow(/gRPC error \(status 2\): bad%ZZencoding/);
    });

    test('rejects when response exceeds maximum size', async () => {
      const { readFile } = await import('node:fs/promises');
      const { connect } = await import('node:http2');
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'gw' })));

      const destroyedStreams: { req: boolean; session: boolean } = { req: false, session: false };

      vi.mocked(connect).mockImplementation(() => {
        const session = new EventEmitter() as ReturnType<typeof connect>;
        session.close = vi.fn();
        session.destroy = vi.fn(() => {
          destroyedStreams.session = true;
        }) as never;

        session.request = vi.fn().mockImplementation(() => {
          const stream = new EventEmitter();
          Object.assign(stream, {
            write: vi.fn(),
            end: vi.fn(),
            destroy: vi.fn(() => {
              destroyedStreams.req = true;
            }),
          });

          process.nextTick(() => {
            stream.emit('response', { ':status': 200 });
            const oversizedChunk = Buffer.alloc(1024 * 1024 + 1);
            stream.emit('data', oversizedChunk);
            stream.emit('end');
          });

          return stream;
        });

        return session;
      });

      await expect(manager.getGatewayInfo('gw')).rejects.toThrow(/exceeded maximum size/);
      expect(destroyedStreams.req).toBe(true);
      expect(destroyedStreams.session).toBe(true);
    });
  });

  describe('health', () => {
    test('delegates to SDK client health check', async () => {
      const mockClient = { health: vi.fn().mockResolvedValue({ status: 'healthy', version: '1.0.0' }) };
      vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient as never);

      const result = await manager.health('my-gw');

      expect(sdkClientManager.getClient).toHaveBeenCalledWith('my-gw');
      expect(result).toEqual({ status: 'healthy', version: '1.0.0' });
    });

    test('passes undefined gateway name when not specified', async () => {
      const mockClient = { health: vi.fn().mockResolvedValue({ status: 'healthy', version: '1.0.0' }) };
      vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient as never);

      await manager.health();

      expect(sdkClientManager.getClient).toHaveBeenCalledWith(undefined);
    });
  });

  describe('path resolution', () => {
    test('uses XDG_CONFIG_HOME when set', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '/custom/config');
      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);

      const { readdir } = await import('node:fs/promises');
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      await manager.listGateways();

      expect(readdir).toHaveBeenCalledWith(join('/custom/config', 'openshell', 'gateways'));
    });

    test.skipIf(process.platform !== 'win32')('uses APPDATA on win32 when XDG_CONFIG_HOME is not set', async () => {
      vi.unstubAllEnvs();
      vi.stubEnv('XDG_CONFIG_HOME', '');
      vi.stubEnv('APPDATA', 'C:\\Users\\test\\AppData\\Roaming');

      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);

      const { readdir } = await import('node:fs/promises');
      vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

      await manager.listGateways();

      expect(readdir).toHaveBeenCalledWith(join('C:\\Users\\test\\AppData\\Roaming', 'openshell', 'gateways'));
    });

    test.skipIf(process.platform === 'win32')(
      'falls back to $HOME/.config on non-win32 without XDG_CONFIG_HOME',
      async () => {
        vi.unstubAllEnvs();
        vi.stubEnv('XDG_CONFIG_HOME', '');
        vi.stubEnv('HOME', '/home/testuser');

        manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);

        const { readdir } = await import('node:fs/promises');
        vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

        await manager.listGateways();

        expect(readdir).toHaveBeenCalledWith(join('/home/testuser', '.config', 'openshell', 'gateways'));
      },
    );

    test('uses OPENSHELL_SYSTEM_GATEWAY_DIR env override for system directory', async () => {
      vi.stubEnv('OPENSHELL_SYSTEM_GATEWAY_DIR', '/custom/system/openshell');

      manager = new OpenshellGatewayManager(gatewayConfig, sdkClientManager);

      const { readdir, readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      vi.mocked(readdir)
        .mockResolvedValueOnce([] as unknown as never[])
        .mockResolvedValueOnce(['sys-gw'] as unknown as never[]);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(validMetadata({ name: 'sys-gw' })));

      const gateways = await manager.listGateways();

      expect(readdir).toHaveBeenCalledWith(join('/custom/system/openshell', 'gateways'));
      expect(gateways).toHaveLength(1);
      expect(gateways[0]!.source).toBe('system');
    });
  });
});
