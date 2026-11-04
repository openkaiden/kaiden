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

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MCPPackage } from '/@/plugin/mcp/package/mcp-package.js';
import type { ProviderRegistry } from '/@/plugin/provider-registry.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info.js';

import type { Certificates } from '../certificates.js';
import type { Proxy } from '../proxy.js';
import type { SafeStorageRegistry } from '../safe-storage/safe-storage-registry.js';
import type { Telemetry } from '../telemetry/telemetry.js';
import type { MCPManager } from './mcp-manager.js';
import { MCPRegistry, normalizeMcpRegistryServerUrl } from './mcp-registry.js';
import type { MCPSchemaValidator } from './mcp-schema-validator.js';

vi.mock(import('/@/plugin/mcp/package/mcp-package.js'));

const proxy: Proxy = {
  onDidStateChange: vi.fn(),
  onDidUpdateProxy: vi.fn(),
  isEnabled: vi.fn().mockReturnValue(false),
} as unknown as Proxy;

const configurationRegistry = {
  registerConfigurations: vi.fn(),
  getConfiguration: vi.fn(),
} as unknown as IConfigurationRegistry;

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};

const validateSchemaDataMock = vi.fn().mockReturnValue(true);

const schemaValidator: MCPSchemaValidator = {
  validateSchemaData: validateSchemaDataMock,
};

let mcpRegistry: MCPRegistry;

const globalFetch = vi.fn();
global.fetch = globalFetch;

const originalConsoleError = console.error;

const providerRegistry = {
  onDidRegisterRagConnection: vi.fn(),
  onDidUnregisterRagConnection: vi.fn(),
  onDidUpdateRagConnection: vi.fn(),
} as unknown as ProviderRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  console.error = vi.fn();

  mcpRegistry = new MCPRegistry(
    apiSender,
    { track: vi.fn() } as unknown as Telemetry,
    {} as Certificates,
    proxy,
    {} as MCPManager,
    {} as SafeStorageRegistry,
    configurationRegistry,
    schemaValidator,
    providerRegistry,
  );
});

afterEach(() => {
  console.error = originalConsoleError;
});

test('normalizeMcpRegistryServerUrl adds https for host-only input', () => {
  expect(normalizeMcpRegistryServerUrl('registry.modelcontextprotocol.io')).toBe(
    'https://registry.modelcontextprotocol.io',
  );
  expect(normalizeMcpRegistryServerUrl('  https://example.com/path  ')).toBe('https://example.com/path');
  expect(normalizeMcpRegistryServerUrl('http://localhost:8080')).toBe('http://localhost:8080');
});

test('normalizeMcpRegistryServerUrl prepends https for host:port input', () => {
  expect(normalizeMcpRegistryServerUrl('localhost:8080')).toBe('https://localhost:8080');
  expect(normalizeMcpRegistryServerUrl('registry.example.com:8443')).toBe('https://registry.example.com:8443');
});

test('normalizeMcpRegistryServerUrl strips trailing slashes', () => {
  expect(normalizeMcpRegistryServerUrl('https://registry.example.com/base///')).toBe(
    'https://registry.example.com/base',
  );
  expect(normalizeMcpRegistryServerUrl('registry.example.com/')).toBe('https://registry.example.com');
});

test('listMCPServersFromRegistries uses https for host-only suggested registry URLs', async () => {
  mcpRegistry.suggestMCPRegistry({
    name: 'Host only',
    url: 'registry.example.com',
  });
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ servers: [] }),
  } as unknown as Response);

  await mcpRegistry.listMCPServersFromRegistries();

  expect(globalFetch).toHaveBeenCalledWith('https://registry.example.com/v0/servers?version=latest', expect.anything());
});

test('listMCPServersFromRegistries strips trailing slashes from registry base URL', async () => {
  mcpRegistry.suggestMCPRegistry({
    name: 'Trailing slashes',
    url: 'https://registry.example.com/base///',
  });
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ servers: [] }),
  } as unknown as Response);

  await mcpRegistry.listMCPServersFromRegistries();

  expect(globalFetch).toHaveBeenCalledWith(
    'https://registry.example.com/base/v0/servers?version=latest',
    expect.anything(),
  );
});

test('updateMCPRegistry sends normalized URL in API event and fire', async () => {
  // Register with a normalized URL so the registry exists internally
  mcpRegistry.registerMCPRegistry({ serverUrl: 'https://registry.example.com' }, false);

  // Update using a non-normalized URL (trailing slash)
  await mcpRegistry.updateMCPRegistry({ serverUrl: 'https://registry.example.com/' });

  expect(apiSender.send).toHaveBeenCalledWith(
    'mcp-registry-update',
    expect.objectContaining({ serverUrl: 'https://registry.example.com' }),
  );
});

test('updateMCPRegistry persists normalized update to internal registry store', async () => {
  mcpRegistry.registerMCPRegistry({ serverUrl: 'https://registry.example.com' }, false);

  await mcpRegistry.updateMCPRegistry({ serverUrl: 'https://registry.example.com/', name: 'Updated Name' });

  const registries = mcpRegistry.getRegistries();
  const updated = registries.find(r => r.serverUrl === 'https://registry.example.com');
  expect(updated).toBeDefined();
  expect(updated?.name).toBe('Updated Name');
});

test('updateMCPRegistry throws when registry not found after normalization', async () => {
  await expect(mcpRegistry.updateMCPRegistry({ serverUrl: 'https://unknown.example.com/' })).rejects.toThrow(
    'MCP Registry https://unknown.example.com was not found',
  );
});

test('unsuggestMCPRegistry sends normalized URL in API event', () => {
  // Suggest with a host-only URL (gets normalized to https://)
  mcpRegistry.suggestMCPRegistry({ name: 'Test', url: 'registry.example.com' });
  vi.mocked(apiSender.send).mockClear();

  // Unsuggest using the non-normalized form
  mcpRegistry.unsuggestMCPRegistry({ name: 'Test', url: 'registry.example.com/' });

  expect(apiSender.send).toHaveBeenCalledWith(
    'mcp-registry-update',
    expect.objectContaining({ url: 'https://registry.example.com', name: 'Test' }),
  );
});

test('listMCPServersFromRegistries', async () => {
  // add suggested registries that will be used to list MCP servers from
  mcpRegistry.suggestMCPRegistry({
    name: 'Registry 1',
    url: 'https://registry1.io',
  });
  mcpRegistry.suggestMCPRegistry({
    name: 'Registry 2',
    url: 'https://registry2.io',
  });
  mcpRegistry.suggestMCPRegistry({
    name: 'Registry 3',
    url: 'https://registry3.io',
  });

  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ servers: [{ server: { name: 'Registry 1 server 1' } }] }),
  } as unknown as Response);
  globalFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) } as unknown as Response);
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [{ server: { name: 'Registry 3 server 1' } }, { server: { name: 'Registry 3 server 2' } }],
    }),
  } as unknown as Response);

  const mcpServersFromRegistries = await mcpRegistry.listMCPServersFromRegistries();
  const serverNames = mcpServersFromRegistries.map(server => server.name);

  expect(console.error).toHaveBeenCalledWith(
    'Failed fetch for registry https://registry2.io',
    new Error('Failed to fetch MCP servers from https://registry2.io: undefined'),
  );
  expect(mcpServersFromRegistries).toHaveLength(3);
  expect(serverNames).toEqual(
    expect.arrayContaining(['Registry 1 server 1', 'Registry 3 server 1', 'Registry 3 server 2']),
  );
});

test('listMCPServersFromRegistries marks servers with invalid schemas', async () => {
  // Mock validateSchemaData to return invalid for specific servers
  validateSchemaDataMock.mockImplementation((data: unknown) => {
    const serverResponse = data as { server: { name: string } };
    const isValid = serverResponse?.server?.name !== 'Invalid server';
    return isValid;
  });

  mcpRegistry.suggestMCPRegistry({
    name: 'Test Registry',
    url: 'https://test-registry.io',
  });

  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Valid server', description: 'A valid server', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Invalid server', description: 'An invalid server', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const mcpServersFromRegistries = await mcpRegistry.listMCPServersFromRegistries();

  expect(mcpServersFromRegistries).toHaveLength(2);

  const validServer = mcpServersFromRegistries.find(s => s.name === 'Valid server');
  const invalidServer = mcpServersFromRegistries.find(s => s.name === 'Invalid server');

  expect(validServer?.isValidSchema).toBe(true);
  expect(invalidServer?.isValidSchema).toBe(false);
});

test('listMCPServersFromRegistries updates existing servers when registry is updated', async () => {
  // Reset mock to return true for all servers
  validateSchemaDataMock.mockReturnValue(true);

  mcpRegistry.suggestMCPRegistry({
    name: 'Update Test Registry',
    url: 'https://update-registry.io',
  });

  // First call - initial server list
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Server A', description: 'Original description', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Server B', description: 'Another server', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const firstResult = await mcpRegistry.listMCPServersFromRegistries();
  expect(firstResult).toHaveLength(2);
  const serverA = firstResult.find(s => s.name === 'Server A');
  expect(serverA?.description).toBe('Original description');

  // Second call - Server A updated with new description
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Server A', description: 'Updated description', version: '2.0.0' }, _meta: {} },
        { server: { name: 'Server B', description: 'Another server', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const secondResult = await mcpRegistry.listMCPServersFromRegistries();
  expect(secondResult).toHaveLength(2);

  const updatedServerA = secondResult.find(s => s.name === 'Server A');
  const unchangedServerB = secondResult.find(s => s.name === 'Server B');

  expect(updatedServerA?.description).toBe('Updated description');
  expect(updatedServerA?.version).toBe('2.0.0');
  expect(unchangedServerB?.description).toBe('Another server');
});

test('listMCPServersFromRegistries adds new servers when registry is updated', async () => {
  // Reset mock to return true for all servers
  validateSchemaDataMock.mockReturnValue(true);

  mcpRegistry.suggestMCPRegistry({
    name: 'Add Test Registry',
    url: 'https://add-registry.io',
  });

  // First call - initial server list with 2 servers
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Server 1', description: 'First server', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Server 2', description: 'Second server', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const firstResult = await mcpRegistry.listMCPServersFromRegistries();
  expect(firstResult).toHaveLength(2);
  expect(firstResult.map(s => s.name)).toEqual(expect.arrayContaining(['Server 1', 'Server 2']));

  // Second call - registry now has 3 servers (new server added)
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Server 1', description: 'First server', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Server 2', description: 'Second server', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Server 3', description: 'New server', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const secondResult = await mcpRegistry.listMCPServersFromRegistries();
  expect(secondResult).toHaveLength(3);

  const serverNames = secondResult.map(s => s.name);
  expect(serverNames).toEqual(expect.arrayContaining(['Server 1', 'Server 2', 'Server 3']));

  const newServer = secondResult.find(s => s.name === 'Server 3');
  expect(newServer?.description).toBe('New server');
});

test('listMCPServersFromRegistries handles both updates and additions', async () => {
  // Reset mock to return true for all servers
  validateSchemaDataMock.mockReturnValue(true);

  mcpRegistry.suggestMCPRegistry({
    name: 'Combined Test Registry',
    url: 'https://combined-registry.io',
  });

  // First call - initial state
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Alpha', description: 'Original alpha', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Beta', description: 'Original beta', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const firstResult = await mcpRegistry.listMCPServersFromRegistries();
  expect(firstResult).toHaveLength(2);

  // Second call - Alpha updated AND Gamma added
  globalFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      servers: [
        { server: { name: 'Alpha', description: 'Updated alpha', version: '2.0.0' }, _meta: {} },
        { server: { name: 'Beta', description: 'Original beta', version: '1.0.0' }, _meta: {} },
        { server: { name: 'Gamma', description: 'New gamma', version: '1.0.0' }, _meta: {} },
      ],
    }),
  } as unknown as Response);

  const secondResult = await mcpRegistry.listMCPServersFromRegistries();
  expect(secondResult).toHaveLength(3);

  const updatedAlpha = secondResult.find(s => s.name === 'Alpha');
  const unchangedBeta = secondResult.find(s => s.name === 'Beta');
  const newGamma = secondResult.find(s => s.name === 'Gamma');

  // Verify the update
  expect(updatedAlpha?.description).toBe('Updated alpha');
  expect(updatedAlpha?.version).toBe('2.0.0');

  // Verify unchanged server
  expect(unchangedBeta?.description).toBe('Original beta');
  expect(unchangedBeta?.version).toBe('1.0.0');

  // Verify the new addition
  expect(newGamma?.description).toBe('New gamma');
  expect(newGamma?.version).toBe('1.0.0');
});

describe('startMCPServer / stopMCPServer', () => {
  const SERVER_KEY = 'internal:test-server:package:0';
  const SERVER_ID = 'test-server';
  const OTHER_SERVER_KEY = 'internal:test-server:package:1';

  const registeredServer: MCPRemoteServerInfo = {
    id: SERVER_KEY,
    infos: { internalProviderId: 'internal', serverId: SERVER_ID, remoteId: 0 },
    name: 'Test MCP',
    description: 'A test server',
    url: '',
    setupType: 'package',
    commandSpec: { command: 'node', args: ['server.js'], env: {} },
    tools: {},
    status: 'registered',
  };

  const spawnedServer: MCPRemoteServerInfo = {
    ...registeredServer,
    status: undefined,
    tools: { myTool: { description: 'a tool' } },
  };

  const otherRegisteredServer: MCPRemoteServerInfo = {
    ...registeredServer,
    id: OTHER_SERVER_KEY,
    infos: { internalProviderId: 'internal', serverId: SERVER_ID, remoteId: 1 },
  };

  const otherSpawnedServer: MCPRemoteServerInfo = {
    ...spawnedServer,
    id: OTHER_SERVER_KEY,
    infos: { internalProviderId: 'internal', serverId: SERVER_ID, remoteId: 1 },
  };

  const remoteServer: MCPRemoteServerInfo = {
    ...registeredServer,
    setupType: 'remote',
    url: 'https://example.com',
  };

  const savedConfig = {
    serverId: SERVER_ID,
    packageId: 0,
    autoSpawn: false,
    runtimeArguments: ['--port=3000'],
    packageArguments: ['serve'],
    environmentVariables: { TOKEN: 'default-token' },
  };

  const serverDetail = {
    serverId: SERVER_ID,
    name: 'Test MCP',
    description: 'A test server',
    packages: [
      {
        registryType: 'npm',
        name: 'test-mcp',
        version: '1.0.0',
        runtimeArguments: [{ default: '--port=3000' }],
        packageArguments: [{ default: 'serve' }],
        environmentVariables: [{ name: 'TOKEN', default: 'default-token' }],
      },
      {
        registryType: 'npm',
        name: 'test-mcp-alt',
        version: '2.0.0',
      },
    ],
  };

  let mockMcpManager: MCPManager;
  let mockSafeStorage: { get: ReturnType<typeof vi.fn>; store: ReturnType<typeof vi.fn> };
  let registry: MCPRegistry;
  let storedConfigs: Array<Record<string, unknown>>;

  beforeEach(() => {
    mockMcpManager = {
      get: vi.fn(),
      addClient: vi.fn(),
      removeClient: vi.fn(),
      listMCPRemoteServers: vi.fn().mockResolvedValue([]),
      registerMCPWithoutClient: vi.fn(),
      registerMCPClient: vi.fn(),
      removeMcpRemoteServer: vi.fn(),
    } as unknown as MCPManager;

    storedConfigs = [{ ...savedConfig }];
    mockSafeStorage = {
      get: vi.fn().mockImplementation(async () => JSON.stringify(storedConfigs)),
      store: vi.fn().mockImplementation(async (_key: string, value: string) => {
        storedConfigs = JSON.parse(value);
      }),
    };

    const mockSafeStorageRegistry = {
      getCoreStorage: vi.fn().mockReturnValue(mockSafeStorage),
    } as unknown as SafeStorageRegistry;

    const localConfigRegistry = {
      registerConfigurations: vi.fn(),
      getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue([]) }),
    } as unknown as IConfigurationRegistry;

    registry = new MCPRegistry(
      apiSender,
      { track: vi.fn() } as unknown as Telemetry,
      {} as Certificates,
      proxy,
      mockMcpManager,
      mockSafeStorageRegistry,
      localConfigRegistry,
      schemaValidator,
      providerRegistry,
    );

    registry.init();
    registry.registerInternalMCPServer(serverDetail as never);
  });

  test('startMCPServer spawns a registered package server', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(registeredServer);

    const mockTransport = {} as Transport;
    vi.mocked(MCPPackage.prototype.spawn).mockResolvedValue(mockTransport);
    vi.mocked(MCPPackage.prototype.buildCommandSpec).mockReturnValue({ command: 'node', args: ['server.js'] });

    await registry.startMCPServer(SERVER_KEY);

    expect(mockMcpManager.addClient).toHaveBeenCalledWith(SERVER_KEY, mockTransport);
    expect(storedConfigs[0]?.['autoSpawn']).toBe(true);
  });

  test('startMCPServer throws if server is already spawned', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(spawnedServer);

    await expect(registry.startMCPServer(SERVER_KEY)).rejects.toThrow('MCP server is already spawned.');
  });

  test('startMCPServer throws for remote servers', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(remoteServer);

    await expect(registry.startMCPServer(SERVER_KEY)).rejects.toThrow('Only package MCP servers can be started.');
  });

  test('stopMCPServer stops a spawned package server', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(spawnedServer);

    await registry.stopMCPServer(SERVER_KEY);

    expect(mockMcpManager.removeClient).toHaveBeenCalledWith(SERVER_KEY);
    expect(storedConfigs[0]?.['autoSpawn']).toBe(false);
  });

  test('stopMCPServer throws if server is already registered', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(registeredServer);

    await expect(registry.stopMCPServer(SERVER_KEY)).rejects.toThrow('MCP server is already stopped.');
  });

  test('stopMCPServer throws for remote servers', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(remoteServer);

    await expect(registry.stopMCPServer(SERVER_KEY)).rejects.toThrow('Only package MCP servers can be stopped.');
  });

  test('setupMCPServer starts the matching registered server and refreshes its saved config', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(registeredServer);
    vi.mocked(mockMcpManager.listMCPRemoteServers).mockResolvedValue([registeredServer]);

    vi.mocked(MCPPackage.prototype.spawn).mockResolvedValue({} as Transport);
    vi.mocked(MCPPackage.prototype.buildCommandSpec).mockReturnValue({ command: 'node', args: ['server.js'] });

    await registry.setupMCPServer(SERVER_ID, {
      type: 'package',
      index: 0,
      runtimeArguments: { 0: { value: '--port=9000', variables: {} } },
      packageArguments: { 0: { value: 'serve-updated', variables: {} } },
      environmentVariables: { TOKEN: { value: 'updated-token', variables: {} } },
    });

    expect(mockMcpManager.addClient).toHaveBeenCalledWith(SERVER_KEY, expect.anything());
    expect(storedConfigs[0]).toMatchObject({
      serverId: SERVER_ID,
      packageId: 0,
      autoSpawn: true,
      runtimeArguments: ['--port=9000'],
      packageArguments: ['serve-updated'],
      environmentVariables: { TOKEN: 'updated-token' },
    });
  });

  test('setupMCPServer throws if server is already spawned', async () => {
    vi.mocked(mockMcpManager.listMCPRemoteServers).mockResolvedValue([spawnedServer]);

    await expect(
      registry.setupMCPServer(SERVER_ID, {
        type: 'package',
        index: 0,
        runtimeArguments: {},
        packageArguments: {},
        environmentVariables: {},
      }),
    ).rejects.toThrow('MCP server is already spawned.');
  });

  test('setupMCPServer registers a different package target for the same server id', async () => {
    vi.mocked(mockMcpManager.listMCPRemoteServers).mockResolvedValue([otherRegisteredServer]);

    vi.mocked(MCPPackage.prototype.spawn).mockResolvedValue({} as Transport);
    vi.mocked(MCPPackage.prototype.buildCommandSpec).mockReturnValue({ command: 'node', args: ['server.js'] });

    await registry.setupMCPServer(SERVER_ID, {
      type: 'package',
      index: 0,
      runtimeArguments: {},
      packageArguments: {},
      environmentVariables: {},
    });

    expect(mockMcpManager.addClient).not.toHaveBeenCalled();
    expect(mockMcpManager.registerMCPClient).toHaveBeenCalledWith(
      'internal',
      SERVER_ID,
      'package',
      0,
      'Test MCP',
      expect.anything(),
      undefined,
      'A test server',
      undefined,
      { command: 'node', args: ['server.js'] },
    );
  });

  test('registerMCPServerOnly stops the matching spawned server and refreshes its saved config', async () => {
    vi.mocked(mockMcpManager.get).mockReturnValue(spawnedServer);
    vi.mocked(mockMcpManager.listMCPRemoteServers).mockResolvedValue([spawnedServer]);

    await registry.registerMCPServerOnly(SERVER_ID, {
      type: 'package',
      index: 0,
      runtimeArguments: { 0: { value: '--port=9100', variables: {} } },
      packageArguments: { 0: { value: 'serve-registered', variables: {} } },
      environmentVariables: { TOKEN: { value: 'registered-token', variables: {} } },
    });

    expect(mockMcpManager.removeClient).toHaveBeenCalledWith(SERVER_KEY);
    expect(storedConfigs[0]).toMatchObject({
      serverId: SERVER_ID,
      packageId: 0,
      autoSpawn: false,
      runtimeArguments: ['--port=9100'],
      packageArguments: ['serve-registered'],
      environmentVariables: { TOKEN: 'registered-token' },
    });
  });

  test('registerMCPServerOnly throws if server is already registered', async () => {
    vi.mocked(mockMcpManager.listMCPRemoteServers).mockResolvedValue([registeredServer]);

    await expect(
      registry.registerMCPServerOnly(SERVER_ID, {
        type: 'package',
        index: 0,
        runtimeArguments: {},
        packageArguments: {},
        environmentVariables: {},
      }),
    ).rejects.toThrow('MCP server is already registered.');
  });

  test('registerMCPServerOnly registers a different package target for the same server id', async () => {
    vi.mocked(mockMcpManager.listMCPRemoteServers).mockResolvedValue([otherSpawnedServer]);

    vi.mocked(MCPPackage.prototype.buildCommandSpec).mockReturnValue({ command: 'node', args: ['server.js'] });

    await registry.registerMCPServerOnly(SERVER_ID, {
      type: 'package',
      index: 0,
      runtimeArguments: {},
      packageArguments: {},
      environmentVariables: {},
    });

    expect(mockMcpManager.removeClient).not.toHaveBeenCalled();
    expect(mockMcpManager.registerMCPWithoutClient).toHaveBeenCalledWith(
      'internal',
      SERVER_ID,
      'package',
      0,
      'Test MCP',
      undefined,
      'A test server',
      undefined,
      { command: 'node', args: ['server.js'] },
    );
  });
});
