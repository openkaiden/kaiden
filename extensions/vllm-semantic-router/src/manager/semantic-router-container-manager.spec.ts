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

import { writeFile } from 'node:fs/promises';

import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ExtensionContext, Provider } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parse, stringify } from 'yaml';

import { EnvoyConfigSchema } from '/@/api/envoy-config-schema';
import { LABEL_ID, LABEL_NAME, LABEL_ROLE } from '/@/api/semantic-router-container-info';
import { SRConfigSchema } from '/@/api/sr-config-schema';
import { ContainerFinder } from '/@/helper/container-finder';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, VllmSemanticRouterProvider } from '/@/inject/symbol';

import { SemanticRouterContainerManager } from './semantic-router-container-manager';

vi.mock(import('@ai-sdk/openai-compatible'));
vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));

const connectionDisposable = { dispose: vi.fn() };
const factoryDisposable = { dispose: vi.fn() };

const routerStartMock = vi.fn().mockResolvedValue(undefined);
const routerStopMock = vi.fn().mockResolvedValue(undefined);
const routerRemoveMock = vi.fn().mockResolvedValue(undefined);

const envoyStartMock = vi.fn().mockResolvedValue(undefined);
const envoyStopMock = vi.fn().mockResolvedValue(undefined);
const envoyRemoveMock = vi.fn().mockResolvedValue(undefined);

const routerContainerMock = {
  id: 'router-container-id',
  start: routerStartMock,
  stop: routerStopMock,
  remove: routerRemoveMock,
};

const envoyContainerMock = {
  id: 'envoy-container-id',
  start: envoyStartMock,
  stop: envoyStopMock,
  remove: envoyRemoveMock,
};

const followProgressMock = vi.fn().mockImplementation((_stream, onFinish) => {
  onFinish(null);
});

const dockerodeMock = {
  pull: vi.fn().mockResolvedValue('stream'),
  modem: { followProgress: followProgressMock },
  createContainer: vi.fn(),
  listContainers: vi.fn().mockResolvedValue([]),
  getContainer: vi.fn(),
};

const providerMock: Provider = {
  setSemanticRouterConnectionFactory: vi.fn().mockReturnValue(factoryDisposable),
  registerInferenceProviderConnection: vi.fn().mockReturnValue(connectionDisposable),
} as unknown as Provider;

const containerExtensionAPIMock: ContainerExtensionAPI = {
  getEndpoints: vi.fn().mockReturnValue([{ path: '/var/run/docker.sock', dockerode: dockerodeMock }]),
} as unknown as ContainerExtensionAPI;

const extensionContextMock: ExtensionContext = {
  storagePath: '/tmp/test-storage',
} as unknown as ExtensionContext;

const defaultConfig = {
  version: 'v0.3',
  listeners: [{ name: 'http-8080', address: '0.0.0.0', port: 8080 }],
  providers: {
    models: [
      {
        name: 'gpt-4',
        provider_model_id: 'gpt-4',
        backend_refs: [{ name: 'primary', endpoint: 'localhost:8000', protocol: 'http', weight: 100 }],
      },
    ],
  },
  routing: {
    signals: { keywords: [] },
    modelCards: [{ name: 'gpt-4', modality: 'text', capabilities: ['chat'] }],
    decisions: [],
  },
  global: {
    services: { router_replay: { enabled: true, store_backend: 'memory' } },
  },
};

describe('SemanticRouterContainerManager', () => {
  let manager: SemanticRouterContainerManager;

  beforeEach(async () => {
    vi.resetAllMocks();

    vi.mocked(providerMock.setSemanticRouterConnectionFactory).mockReturnValue(factoryDisposable);
    vi.mocked(providerMock.registerInferenceProviderConnection).mockReturnValue(connectionDisposable);
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([
      { path: '/var/run/docker.sock', dockerode: dockerodeMock } as never,
    ]);
    dockerodeMock.pull.mockResolvedValue('stream');
    followProgressMock.mockImplementation((_stream: unknown, onFinish: (err: Error | null) => void) => {
      onFinish(null);
    });
    dockerodeMock.createContainer.mockResolvedValueOnce(routerContainerMock).mockResolvedValueOnce(envoyContainerMock);
    dockerodeMock.listContainers.mockResolvedValue([]);
    dockerodeMock.getContainer.mockImplementation((id: string) => {
      if (id === routerContainerMock.id) return routerContainerMock;
      if (id === envoyContainerMock.id) return envoyContainerMock;
      return routerContainerMock;
    });
    routerStartMock.mockResolvedValue(undefined);
    routerStopMock.mockResolvedValue(undefined);
    routerRemoveMock.mockResolvedValue(undefined);
    envoyStartMock.mockResolvedValue(undefined);
    envoyStopMock.mockResolvedValue(undefined);
    envoyRemoveMock.mockResolvedValue(undefined);

    const container = new Container();
    container.bind(SemanticRouterContainerManager).toSelf();
    container.bind(ContainerFinder).toSelf();
    container.bind(VllmSemanticRouterProvider).toConstantValue(providerMock);
    container.bind(ContainerExtensionAPISymbol).toConstantValue(containerExtensionAPIMock);
    container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
    manager = await container.getAsync(SemanticRouterContainerManager);
  });

  test('init registers semantic router factory', async () => {
    await manager.init();

    expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vllm' }),
    );
  });

  test('create creates router and envoy containers in stopped state', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(dockerodeMock.pull).toHaveBeenCalledWith('ghcr.io/vllm-project/semantic-router/vllm-sr:v0.3.0');
    expect(dockerodeMock.pull).toHaveBeenCalledWith('envoyproxy/envoy:v1.34-latest');
    expect(dockerodeMock.createContainer).toHaveBeenCalledTimes(2);

    const routerCall = dockerodeMock.createContainer.mock.calls[0]![0];
    expect(routerCall.Image).toBe('ghcr.io/vllm-project/semantic-router/vllm-sr:v0.3.0');
    expect(routerCall.Labels[LABEL_NAME]).toBe('my-router');
    expect(routerCall.Labels[LABEL_ROLE]).toBe('router');
    expect(routerCall.HostConfig.PortBindings['50051/tcp']).toBeDefined();
    expect(routerCall.HostConfig.Mounts[0].Source).toBe('/tmp/test-storage/configs/my-router/config.yaml');
    expect(routerCall.HostConfig.Mounts[0].Target).toBe('/app/config.yaml');

    const envoyCall = dockerodeMock.createContainer.mock.calls[1]![0];
    expect(envoyCall.Image).toBe('envoyproxy/envoy:v1.34-latest');
    expect(envoyCall.User).toBe('101');
    expect(envoyCall.Cmd).toEqual(['envoy', '-c', '/etc/envoy/envoy.yaml', '-l', 'debug']);
    expect(envoyCall.Labels[LABEL_NAME]).toBe('my-router');
    expect(envoyCall.Labels[LABEL_ROLE]).toBe('envoy');
    expect(envoyCall.HostConfig.PortBindings['8801/tcp']).toBeDefined();
    expect(envoyCall.HostConfig.Mounts[0].Source).toBe('/tmp/test-storage/configs/my-router/envoy.yaml');
    expect(envoyCall.HostConfig.Mounts[0].Target).toBe('/etc/envoy/envoy.yaml');
    expect(envoyCall.HostConfig.ExtraHosts).toContain('host.docker.internal:host-gateway');

    expect(routerStartMock).not.toHaveBeenCalled();
    expect(envoyStartMock).not.toHaveBeenCalled();

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    expect(registeredConnection.name).toBe('my-router');
    expect(registeredConnection.type).toBe('local');
    expect(registeredConnection.status()).toBe('stopped');
    expect(registeredConnection.endpoint).toMatch(/^http:\/\/localhost:\d+\/v1$/);
  });

  test('create generates envoy config with ExtProc and backend clusters from SR config', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    const envoyConfigCall = vi.mocked(writeFile).mock.calls.find(c => (c[0] as string).endsWith('/envoy.yaml'));
    expect(envoyConfigCall).toBeDefined();

    const envoyConfig = parse(envoyConfigCall![1] as string) as Record<string, unknown>;
    const clusters = (envoyConfig.static_resources as Record<string, unknown>).clusters as Array<
      Record<string, unknown>
    >;

    const extprocCluster = clusters.find(c => c.name === 'extproc_service');
    expect(extprocCluster).toBeDefined();

    const routerPortBinding = dockerodeMock.createContainer.mock.calls[0]![0].HostConfig.PortBindings['50051/tcp'][0];
    const expectedPort = Number(routerPortBinding.HostPort);

    const endpoints = (extprocCluster!.load_assignment as Record<string, unknown>).endpoints as Array<
      Record<string, unknown>
    >;
    const lbEndpoints = endpoints[0]!.lb_endpoints as Array<Record<string, unknown>>;
    const socketAddress = ((lbEndpoints[0]!.endpoint as Record<string, unknown>).address as Record<string, unknown>)
      .socket_address as Record<string, unknown>;
    expect(socketAddress.address).toBe('host.docker.internal');
    expect(socketAddress.port_value).toBe(expectedPort);

    const backendCluster = clusters.find(c => c.name === 'gpt-4');
    expect(backendCluster).toBeDefined();
    const backendEndpoints = (backendCluster!.load_assignment as Record<string, unknown>).endpoints as Array<
      Record<string, unknown>
    >;
    const backendLbEndpoints = backendEndpoints[0]!.lb_endpoints as Array<Record<string, unknown>>;
    const backendAddr = (
      (backendLbEndpoints[0]!.endpoint as Record<string, unknown>).address as Record<string, unknown>
    ).socket_address as Record<string, unknown>;
    expect(backendAddr.address).toBe('localhost');
    expect(backendAddr.port_value).toBe(8000);
  });

  test('create generates envoy config with one cluster per model', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    const multiBackendConfig = {
      ...defaultConfig,
      providers: {
        models: [
          {
            name: 'model-a',
            provider_model_id: 'model-a',
            backend_refs: [{ name: 'primary', endpoint: 'host-a:8000', protocol: 'http', weight: 100 }],
          },
          {
            name: 'model-b',
            provider_model_id: 'model-b',
            backend_refs: [{ name: 'primary', endpoint: 'host-b:9000', protocol: 'http', weight: 100 }],
          },
          {
            name: 'model-c',
            provider_model_id: 'model-c',
            backend_refs: [{ name: 'primary', endpoint: 'host-a:8000', protocol: 'http', weight: 100 }],
          },
        ],
      },
    };

    await manager.create({ name: 'my-router', config: stringify(multiBackendConfig) });

    const envoyConfigCall = vi.mocked(writeFile).mock.calls.find(c => (c[0] as string).endsWith('/envoy.yaml'));
    const envoyConfig = parse(envoyConfigCall![1] as string) as Record<string, unknown>;
    const clusters = (envoyConfig.static_resources as Record<string, unknown>).clusters as Array<
      Record<string, unknown>
    >;

    const modelClusters = clusters.filter(c => c.name !== 'extproc_service');
    expect(modelClusters).toHaveLength(3);
    expect(modelClusters.find(c => c.name === 'model-a')).toBeDefined();
    expect(modelClusters.find(c => c.name === 'model-b')).toBeDefined();
    expect(modelClusters.find(c => c.name === 'model-c')).toBeDefined();
  });

  test('create defaults backend port to 80 when endpoint has no port', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    const noPortConfig = {
      ...defaultConfig,
      providers: {
        models: [
          {
            name: 'model-a',
            provider_model_id: 'model-a',
            backend_refs: [{ name: 'primary', endpoint: 'my-backend', protocol: 'http', weight: 100 }],
          },
        ],
      },
    };

    await manager.create({ name: 'my-router', config: stringify(noPortConfig) });

    const envoyConfigCall = vi.mocked(writeFile).mock.calls.find(c => (c[0] as string).endsWith('/envoy.yaml'));
    const envoyConfig = parse(envoyConfigCall![1] as string) as Record<string, unknown>;
    const clusters = (envoyConfig.static_resources as Record<string, unknown>).clusters as Array<
      Record<string, unknown>
    >;

    const backendCluster = clusters.find(c => c.name === 'model-a');
    expect(backendCluster).toBeDefined();
    const addr = (
      (
        ((backendCluster!.load_assignment as Record<string, unknown>).endpoints as Array<Record<string, unknown>>)[0]!
          .lb_endpoints as Array<Record<string, unknown>>
      )[0]!.endpoint as Record<string, unknown>
    ).address as Record<string, unknown>;
    const socketAddress = addr.socket_address as Record<string, unknown>;
    expect(socketAddress.address).toBe('my-backend');
    expect(socketAddress.port_value).toBe(80);
  });

  test('create skips backend with invalid port', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    const badPortConfig = {
      ...defaultConfig,
      providers: {
        models: [
          {
            name: 'model-a',
            provider_model_id: 'model-a',
            backend_refs: [{ name: 'primary', endpoint: 'host:notaport', protocol: 'http', weight: 100 }],
          },
        ],
      },
    };

    await manager.create({ name: 'my-router', config: stringify(badPortConfig) });

    const envoyConfigCall = vi.mocked(writeFile).mock.calls.find(c => (c[0] as string).endsWith('/envoy.yaml'));
    const envoyConfig = parse(envoyConfigCall![1] as string) as Record<string, unknown>;
    const clusters = (envoyConfig.static_resources as Record<string, unknown>).clusters as Array<
      Record<string, unknown>
    >;

    const backendClusters = clusters.filter(c => (c.name as string).startsWith('backend_'));
    expect(backendClusters).toHaveLength(0);
  });

  test('generated envoy config passes schema validation', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    const envoyConfigCall = vi.mocked(writeFile).mock.calls.find(c => (c[0] as string).endsWith('/envoy.yaml'));
    const roundtripped = parse(envoyConfigCall![1] as string) as unknown;
    expect(() => EnvoyConfigSchema.parse(roundtripped)).not.toThrow();
  });

  test('SR config passes schema validation', () => {
    expect(() => SRConfigSchema.parse(defaultConfig)).not.toThrow();
  });

  test('create throws when no container engine is available', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await expect(manager.create({ name: 'no-engine', config: stringify(defaultConfig) })).rejects.toThrow(
      'No container engine available',
    );
  });

  test('create reuses existing running containers', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    dockerodeMock.listContainers.mockResolvedValue([
      {
        Id: 'existing-router',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'existing-uuid', [LABEL_ROLE]: 'router' },
        State: 'running',
        Ports: [{ PublicPort: 9999, PrivatePort: 50051, Type: 'tcp' }],
      },
      {
        Id: 'existing-envoy',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'existing-uuid', [LABEL_ROLE]: 'envoy' },
        State: 'running',
        Ports: [{ PublicPort: 8888, PrivatePort: 8801, Type: 'tcp' }],
      },
    ]);

    const result = await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(result.connectionId).toBe('existing-uuid');
    expect(dockerodeMock.pull).not.toHaveBeenCalled();
    expect(dockerodeMock.createContainer).not.toHaveBeenCalled();

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    expect(registeredConnection.endpoint).toBe('http://localhost:8888/v1');
    expect(registeredConnection.status()).toBe('started');
  });

  test('create reuses existing stopped containers', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    dockerodeMock.listContainers.mockResolvedValue([
      {
        Id: 'stopped-router',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'stopped-uuid', [LABEL_ROLE]: 'router' },
        State: 'exited',
        Ports: [{ PublicPort: 9999, PrivatePort: 50051, Type: 'tcp' }],
      },
      {
        Id: 'stopped-envoy',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'stopped-uuid', [LABEL_ROLE]: 'envoy' },
        State: 'exited',
        Ports: [{ PublicPort: 8888, PrivatePort: 8801, Type: 'tcp' }],
      },
    ]);

    const result = await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(result.connectionId).toBe('stopped-uuid');
    expect(dockerodeMock.pull).not.toHaveBeenCalled();

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    expect(registeredConnection.status()).toBe('stopped');
  });

  test('create creates fresh containers when envoy has no mapped port', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    dockerodeMock.listContainers.mockResolvedValue([
      {
        Id: 'router-ok',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'some-uuid', [LABEL_ROLE]: 'router' },
        State: 'running',
        Ports: [{ PublicPort: 9999, PrivatePort: 50051, Type: 'tcp' }],
      },
      {
        Id: 'envoy-no-port',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'some-uuid', [LABEL_ROLE]: 'envoy' },
        State: 'running',
        Ports: [],
      },
    ]);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(dockerodeMock.pull).toHaveBeenCalled();
    expect(dockerodeMock.createContainer).toHaveBeenCalledTimes(2);
  });

  test('create creates fresh containers when only router exists (no envoy)', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    dockerodeMock.listContainers.mockResolvedValue([
      {
        Id: 'router-only',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'partial-uuid', [LABEL_ROLE]: 'router' },
        State: 'running',
        Ports: [{ PublicPort: 9999, PrivatePort: 50051, Type: 'tcp' }],
      },
    ]);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(dockerodeMock.pull).toHaveBeenCalled();
    expect(dockerodeMock.createContainer).toHaveBeenCalledTimes(2);
  });

  test('lifecycle.start starts router then envoy and updates status', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    expect(registeredConnection.status()).toBe('stopped');

    await registeredConnection.lifecycle!.start!({} as never, {} as never);

    expect(routerStartMock).toHaveBeenCalled();
    expect(envoyStartMock).toHaveBeenCalled();
    const routerStartOrder = routerStartMock.mock.invocationCallOrder[0]!;
    const envoyStartOrder = envoyStartMock.mock.invocationCallOrder[0]!;
    expect(routerStartOrder).toBeLessThan(envoyStartOrder);
    expect(registeredConnection.status()).toBe('started');
  });

  test('lifecycle.stop stops envoy then router and updates status', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    dockerodeMock.listContainers.mockResolvedValue([
      {
        Id: 'running-router',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'run-uuid', [LABEL_ROLE]: 'router' },
        State: 'running',
        Ports: [{ PublicPort: 9999, PrivatePort: 50051, Type: 'tcp' }],
      },
      {
        Id: 'running-envoy',
        Labels: { [LABEL_NAME]: 'my-router', [LABEL_ID]: 'run-uuid', [LABEL_ROLE]: 'envoy' },
        State: 'running',
        Ports: [{ PublicPort: 8888, PrivatePort: 8801, Type: 'tcp' }],
      },
    ]);

    dockerodeMock.getContainer.mockImplementation((id: string) => {
      if (id === 'running-router') return { start: routerStartMock, stop: routerStopMock, remove: routerRemoveMock };
      if (id === 'running-envoy') return { start: envoyStartMock, stop: envoyStopMock, remove: envoyRemoveMock };
      return routerContainerMock;
    });

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    expect(registeredConnection.status()).toBe('started');

    await registeredConnection.lifecycle!.stop!({} as never, {} as never);

    expect(envoyStopMock).toHaveBeenCalled();
    expect(routerStopMock).toHaveBeenCalled();
    const envoyStopOrder = envoyStopMock.mock.invocationCallOrder[0]!;
    const routerStopOrder = routerStopMock.mock.invocationCallOrder[0]!;
    expect(envoyStopOrder).toBeLessThan(routerStopOrder);
    expect(registeredConnection.status()).toBe('stopped');
  });

  test('lifecycle.delete stops and removes both containers', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'delete-me', config: stringify({ ...defaultConfig, name: 'delete-me' }) });

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    await registeredConnection.lifecycle!.delete!();

    expect(routerStopMock).toHaveBeenCalled();
    expect(routerRemoveMock).toHaveBeenCalled();
    expect(envoyStopMock).toHaveBeenCalled();
    expect(envoyRemoveMock).toHaveBeenCalled();
    expect(connectionDisposable.dispose).toHaveBeenCalled();
  });

  test('dispose cleans up factory and all connection registrations', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValue({} as unknown as OpenAICompatibleProvider);

    await manager.init();
    await manager.create({ name: 'dispose-router', config: stringify({ ...defaultConfig, name: 'dispose-router' }) });

    manager.dispose();

    expect(factoryDisposable.dispose).toHaveBeenCalled();
    expect(connectionDisposable.dispose).toHaveBeenCalled();
  });
});
