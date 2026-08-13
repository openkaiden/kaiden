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

import type { Stats } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ExtensionContext, Provider } from '@openkaiden/api';
import { net } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import { Container } from 'inversify';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';
import { stringify } from 'yaml';

import { SemanticRouterImage, SemanticRouterLabel } from '/@/api/semantic-router-container-info';
import { type SRConfig, SRConfigSchema } from '/@/api/sr-config-schema';
import { ContainerFinder } from '/@/helper/container-finder';
import { EnvoyConfigGenerator } from '/@/helper/envoy-config-generator';
import { ImageHelper } from '/@/helper/image-helper';
import { MountHelper } from '/@/helper/mount-helper';
import { NetworkHelper } from '/@/helper/network-helper';
import { SemanticRouterConfigParser } from '/@/helper/semantic-router-config-parser';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, VllmSemanticRouterProvider } from '/@/inject/symbol';

import { SemanticRouterContainerManager } from './semantic-router-container-manager';

vi.mock(import('@ai-sdk/openai-compatible'));
vi.mock(import('node:fs/promises'));
vi.mock(import('/@/helper/network-helper'));
vi.mock(import('/@/helper/semantic-router-config-parser'));
vi.mock(import('/@/helper/envoy-config-generator'));
vi.mock(import('/@/helper/image-helper'));
vi.mock(import('/@/helper/mount-helper'));

const connectionDisposable = { dispose: vi.fn() };
const factoryDisposable = { dispose: vi.fn() };
const endpointsSubscription = { dispose: vi.fn() };
const containersSubscription = { dispose: vi.fn() };

const routerStartMock = vi.fn();
const routerStopMock = vi.fn();
const routerRemoveMock = vi.fn();

const envoyStartMock = vi.fn();
const envoyStopMock = vi.fn();
const envoyRemoveMock = vi.fn();

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

const dockerodeMock = {
  createContainer: vi.fn(),
  listContainers: vi.fn(),
  getContainer: vi.fn(),
};

const providerMock: Provider = {
  setSemanticRouterConnectionFactory: vi.fn(),
  registerInferenceProviderConnection: vi.fn(),
} as unknown as Provider;

const containerExtensionAPIMock: ContainerExtensionAPI = {
  getEndpoints: vi.fn().mockReturnValue([{ path: '/var/run/docker.sock', dockerode: dockerodeMock }]),
  onEndpointsChanged: vi.fn(),
  onContainersChanged: vi.fn(),
} as unknown as ContainerExtensionAPI;

const STORAGE_PATH = path.join(path.sep, 'tmp', 'test-storage');
const extensionContextMock: ExtensionContext = {
  storagePath: STORAGE_PATH,
} as unknown as ExtensionContext;

const ENVOY_CONFIG_PATH = path.join(STORAGE_PATH, 'configs', 'my-router', 'envoy.yaml');
const GENERATED_ENVOY_CONFIG = 'generated envoy config';

const defaultConfig = {
  version: 'v0.3',
  // port 0: a free port is picked
  listeners: [{ name: 'http-auto', address: '127.0.0.1', port: 0 }],
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

const PARSED_CONFIG: SRConfig = SRConfigSchema.parse(defaultConfig);

describe('SemanticRouterContainerManager', () => {
  let manager: SemanticRouterContainerManager;

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();

    vi.mocked(providerMock.setSemanticRouterConnectionFactory).mockReturnValue(factoryDisposable);
    vi.mocked(providerMock.registerInferenceProviderConnection).mockReturnValue(connectionDisposable);
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([
      { path: '/var/run/docker.sock', dockerode: dockerodeMock } as never,
    ]);
    vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mockReturnValue(endpointsSubscription);
    vi.mocked(containerExtensionAPIMock.onContainersChanged).mockReturnValue(containersSubscription);
    dockerodeMock.listContainers.mockResolvedValue([]);
    dockerodeMock.createContainer.mockResolvedValueOnce(routerContainerMock).mockResolvedValueOnce(envoyContainerMock);
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
    // sequential like the real implementation: 50001 for the envoy port, then the requested start for the api port
    vi.mocked(net.getFreePort).mockImplementation(port => Promise.resolve(port === 0 ? 50001 : port));
    vi.mocked(SemanticRouterConfigParser.prototype.parseConfig).mockReturnValue(PARSED_CONFIG);
    vi.mocked(EnvoyConfigGenerator.prototype.generate).mockReturnValue(GENERATED_ENVOY_CONFIG);
    vi.mocked(ImageHelper.prototype.ensureImage).mockResolvedValue(undefined);
    vi.mocked(MountHelper.prototype.getReadOnlyFileBinds)
      .mockReturnValue([])
      .mockReturnValueOnce(['router-config-bind'])
      .mockReturnValueOnce(['envoy-config-bind']);

    const container = new Container();
    container.bind(SemanticRouterContainerManager).toSelf();
    container.bind(ContainerFinder).toSelf();
    container.bind(NetworkHelper).toSelf();
    container.bind(SemanticRouterConfigParser).toSelf();
    container.bind(EnvoyConfigGenerator).toSelf();
    container.bind(ImageHelper).toSelf();
    container.bind(MountHelper).toSelf();
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

  test('init does not register the factory when no endpoint is available', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await manager.init();

    expect(containerExtensionAPIMock.onEndpointsChanged).toHaveBeenCalled();
    expect(providerMock.setSemanticRouterConnectionFactory).not.toHaveBeenCalled();
  });

  test('registers the factory when endpoints appear', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);
    await manager.init();
    const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
    assert(listener);

    listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

    expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledOnce();
    expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'vllm' }),
    );
  });

  test('does not register the factory twice when endpoints change but remain available', async () => {
    await manager.init();
    const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
    assert(listener);

    listener([{ path: '/var/run/other.sock', dockerode: dockerodeMock } as never]);

    expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledOnce();
    expect(factoryDisposable.dispose).not.toHaveBeenCalled();
  });

  test('unregisters the factory when no endpoint remains and registers it again when one comes back', async () => {
    await manager.init();
    const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
    assert(listener);

    listener([]);

    expect(factoryDisposable.dispose).toHaveBeenCalledOnce();

    listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

    expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledTimes(2);
  });

  describe('existing containers discovery', () => {
    const routerInspectMock = vi.fn();

    function existingContainers(state: string, name = 'existing'): unknown[] {
      return [
        {
          Id: 'existing-router',
          Labels: { [SemanticRouterLabel.NAME]: name, [SemanticRouterLabel.ROLE]: 'router' },
          State: state,
        },
        {
          Id: 'existing-envoy',
          Labels: { [SemanticRouterLabel.NAME]: name, [SemanticRouterLabel.ROLE]: 'envoy' },
          State: state,
        },
        { Id: 'unrelated', Labels: {}, State: 'running' },
      ];
    }

    beforeEach(() => {
      dockerodeMock.getContainer.mockImplementation((id: string) => {
        if (id === 'existing-router') return { ...routerContainerMock, inspect: routerInspectMock };
        return routerContainerMock;
      });
      routerInspectMock.mockResolvedValue({
        HostConfig: { PortBindings: { '8801/tcp': [{ HostPort: '8888' }], '8080/tcp': [{ HostPort: '8889' }] } },
      });
      vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats);
    });

    test.each([
      ['running', 'started'],
      ['exited', 'stopped'],
    ])('init registers existing %s containers as a %s connection', async (state, status) => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers(state));

      await manager.init();

      expect(dockerodeMock.listContainers).toHaveBeenCalledWith({ all: true });
      expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledOnce();
      expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
        1,
        expect.toSatisfy(registeredConnection => {
          expect(registeredConnection.id).toBe('existing');
          expect(registeredConnection.name).toBe('existing');
          expect(registeredConnection.endpoint).toBe('http://localhost:8888/v1');
          expect(registeredConnection.status()).toBe(status);
          return true;
        }),
      );
    });

    test('init does not look for existing containers when no endpoint is available', async () => {
      vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

      await manager.init();

      expect(dockerodeMock.listContainers).not.toHaveBeenCalled();
    });

    test('registers existing containers when endpoints appear', async () => {
      vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      await manager.init();
      const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
      assert(listener);

      listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

      await vi.waitFor(() => expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledOnce());
    });

    test('does not register an existing connection twice when endpoints change but its engine remains', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      await manager.init();
      const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
      assert(listener);

      listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

      await vi.waitFor(() => expect(dockerodeMock.listContainers).toHaveBeenCalledTimes(2));
      expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledOnce();
      expect(connectionDisposable.dispose).not.toHaveBeenCalled();
    });

    test('registers a router only once when discoveries overlap', async () => {
      vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      await manager.init();
      const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
      assert(listener);

      listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);
      listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

      await vi.waitFor(() => expect(dockerodeMock.listContainers).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalled());
      expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledOnce();
    });

    test('unregisters connections when their engine goes away and registers them again when it comes back', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      await manager.init();
      const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
      assert(listener);

      listener([]);

      await vi.waitFor(() => expect(connectionDisposable.dispose).toHaveBeenCalledOnce());
      expect(factoryDisposable.dispose).toHaveBeenCalledOnce();

      listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

      await vi.waitFor(() => expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledTimes(2));
    });

    describe('with a second engine', () => {
      const otherRouterInspectMock = vi.fn();
      const otherDockerodeMock = { listContainers: vi.fn(), getContainer: vi.fn() };
      const otherEndpoint = { path: '/run/podman/podman.sock', dockerode: otherDockerodeMock } as never;
      const firstEndpoint = { path: '/var/run/docker.sock', dockerode: dockerodeMock } as never;

      beforeEach(() => {
        otherDockerodeMock.listContainers.mockResolvedValue(existingContainers('running', 'other'));
        otherDockerodeMock.getContainer.mockReturnValue({ inspect: otherRouterInspectMock });
        otherRouterInspectMock.mockResolvedValue({
          HostConfig: { PortBindings: { '8801/tcp': [{ HostPort: '9999' }], '8080/tcp': [{ HostPort: '9998' }] } },
        });
      });

      test('discovers the routers of an engine added later', async () => {
        await manager.init();
        const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
        assert(listener);

        listener([firstEndpoint, otherEndpoint]);

        await vi.waitFor(() => expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledOnce());
        expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ id: 'other', endpoint: 'http://localhost:9999/v1' }),
        );
      });

      test('keeps the connections of the remaining engine when another engine goes away', async () => {
        const firstDisposable = { dispose: vi.fn() };
        const otherDisposable = { dispose: vi.fn() };
        vi.mocked(providerMock.registerInferenceProviderConnection)
          .mockReturnValueOnce(firstDisposable)
          .mockReturnValueOnce(otherDisposable);
        dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
        vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([firstEndpoint, otherEndpoint]);
        await manager.init();
        expect(providerMock.registerInferenceProviderConnection).toHaveBeenCalledTimes(2);
        const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
        assert(listener);

        listener([firstEndpoint]);

        await vi.waitFor(() => expect(otherDisposable.dispose).toHaveBeenCalledOnce());
        expect(firstDisposable.dispose).not.toHaveBeenCalled();
        expect(factoryDisposable.dispose).not.toHaveBeenCalled();
      });
    });

    // an unhandled rejection would fail the test run
    test('catches errors when registering the factory fails after endpoints change', async () => {
      vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);
      await manager.init();
      const listener = vi.mocked(containerExtensionAPIMock.onEndpointsChanged).mock.calls[0]?.[0];
      assert(listener);
      vi.mocked(providerMock.setSemanticRouterConnectionFactory).mockImplementation(() => {
        throw new Error('registration failed');
      });

      listener([{ path: '/var/run/docker.sock', dockerode: dockerodeMock } as never]);

      await vi.waitFor(() => expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledOnce());
      expect(dockerodeMock.listContainers).not.toHaveBeenCalled();
    });

    test('skips a router whose name is invalid', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running', '../../..'));
      vi.mocked(SemanticRouterConfigParser.prototype.validateName).mockImplementation(() => {
        throw new Error('invalid name');
      });

      await manager.init();

      expect(SemanticRouterConfigParser.prototype.validateName).toHaveBeenCalledWith('../../..');
      expect(stat).not.toHaveBeenCalled();
      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });

    test('checks the config folder of the discovered router', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));

      await manager.init();

      expect(stat).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs', 'existing'));
    });

    test.each([
      ['is missing', Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })],
      ['cannot be read', Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })],
    ])('skips a router whose config folder %s', async (_label, error) => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      vi.mocked(stat).mockRejectedValue(error);

      await manager.init();

      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });

    test('skips a router whose config path is not a folder', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      vi.mocked(stat).mockResolvedValue({ isDirectory: () => false } as Stats);

      await manager.init();

      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });

    test('skips a router without envoy container', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running').slice(0, 1));

      await manager.init();

      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });

    test.each([
      ['no port bindings', { HostConfig: {} }],
      [
        'only the gRPC port bound (created before envoy shared its network)',
        { HostConfig: { PortBindings: { '50051/tcp': [{ HostIp: '127.0.0.1', HostPort: '50001' }] } } },
      ],
      [
        'no router api port bound (created before readiness checks)',
        { HostConfig: { PortBindings: { '8801/tcp': [{ HostPort: '8888' }] } } },
      ],
      [
        'an invalid envoy host port',
        { HostConfig: { PortBindings: { '8801/tcp': [{ HostPort: '' }], '8080/tcp': [{ HostPort: '8889' }] } } },
      ],
    ])('skips a router whose container has %s', async (_label, inspectResult) => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      routerInspectMock.mockResolvedValue(inspectResult);

      await manager.init();

      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });

    test('keeps the factory registered when listing containers fails', async () => {
      dockerodeMock.listContainers.mockRejectedValue(new Error('engine unavailable'));

      await manager.init();

      expect(providerMock.setSemanticRouterConnectionFactory).toHaveBeenCalledOnce();
      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });

    test('skips a router whose container cannot be inspected', async () => {
      dockerodeMock.listContainers.mockResolvedValue(existingContainers('running'));
      routerInspectMock.mockRejectedValue(new Error('inspect failed'));

      await expect(manager.init()).resolves.toBeUndefined();

      expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    });
  });

  test('create creates router and envoy containers in stopped state', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(ImageHelper.prototype.ensureImage).toHaveBeenNthCalledWith(
      1,
      dockerodeMock,
      SemanticRouterImage.ROUTER,
      undefined,
    );
    expect(ImageHelper.prototype.ensureImage).toHaveBeenNthCalledWith(
      2,
      dockerodeMock,
      SemanticRouterImage.ENVOY,
      undefined,
    );
    expect(dockerodeMock.createContainer).toHaveBeenCalledTimes(2);

    expect(dockerodeMock.createContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Image: SemanticRouterImage.ROUTER,
        Labels: { [SemanticRouterLabel.NAME]: 'my-router', [SemanticRouterLabel.ROLE]: 'router' },
        // the envoy and router api ports: the router gRPC port is not published
        ExposedPorts: { '8801/tcp': {}, '8080/tcp': {} },
        HostConfig: expect.objectContaining({
          PortBindings: {
            '8801/tcp': [{ HostIp: '127.0.0.1', HostPort: '50001' }],
            '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '50002' }],
          },
          Binds: ['router-config-bind'],
        }),
      }),
    );

    expect(dockerodeMock.createContainer).toHaveBeenNthCalledWith(
      2,
      // exact match: envoy shares the router network and publishes no port
      {
        Image: SemanticRouterImage.ENVOY,
        User: '101',
        Cmd: ['envoy', '-c', '/etc/envoy/envoy.yaml', '-l', 'debug'],
        Labels: { [SemanticRouterLabel.NAME]: 'my-router', [SemanticRouterLabel.ROLE]: 'envoy' },
        HostConfig: {
          NetworkMode: 'container:router-container-id',
          Binds: ['envoy-config-bind'],
        },
      },
    );

    // the config files are mounted read-only through the mount helper
    expect(MountHelper.prototype.getReadOnlyFileBinds).toHaveBeenNthCalledWith(1, [
      { source: path.join(STORAGE_PATH, 'configs', 'my-router', 'config.yaml'), target: '/app/config.yaml' },
    ]);
    expect(MountHelper.prototype.getReadOnlyFileBinds).toHaveBeenNthCalledWith(2, [
      { source: ENVOY_CONFIG_PATH, target: '/etc/envoy/envoy.yaml' },
    ]);

    expect(routerStartMock).not.toHaveBeenCalled();
    expect(envoyStartMock).not.toHaveBeenCalled();

    expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
      1,
      expect.toSatisfy(registeredConnection => {
        expect(registeredConnection.name).toBe('my-router');
        expect(registeredConnection.type).toBe('local');
        expect(registeredConnection.status()).toBe('stopped');
        expect(registeredConnection.endpoint).toMatch(/^http:\/\/localhost:\d+\/v1$/);
        return true;
      }),
    );
  });

  test.each([
    { dev: true, level: 'debug', tracesExporter: 'console' },
    { dev: false, level: 'info', tracesExporter: 'none' },
  ])('create sets log level $level and traces exporter $tracesExporter when DEV is $dev', async ({
    dev,
    level,
    tracesExporter,
  }) => {
    vi.stubEnv('DEV', dev);
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(dockerodeMock.createContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        Env: expect.arrayContaining([`SR_LOG_LEVEL=${level}`, `OTEL_TRACES_EXPORTER=${tracesExporter}`]),
      }),
    );
    expect(dockerodeMock.createContainer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ Cmd: ['envoy', '-c', '/etc/envoy/envoy.yaml', '-l', level] }),
    );
  });

  test('create publishes the envoy and router api ports, on loopback, from the router container', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(net.getFreePort).toHaveBeenCalledTimes(2);
    expect(net.getFreePort).toHaveBeenNthCalledWith(1, 0);
    // ports are only reserved when the container starts: the api port is searched after the envoy port
    expect(net.getFreePort).toHaveBeenNthCalledWith(2, 50002);

    expect(dockerodeMock.createContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          PortBindings: {
            '8801/tcp': [{ HostIp: '127.0.0.1', HostPort: '50001' }],
            '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '50002' }],
          },
        }),
      }),
    );

    expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ endpoint: 'http://localhost:50001/v1' }),
    );
  });

  describe('listener', () => {
    function withListener(listener: { address: string; port: number }): void {
      vi.mocked(SemanticRouterConfigParser.prototype.parseConfig).mockReturnValue({
        ...PARSED_CONFIG,
        listeners: [{ name: 'http', ...listener }],
      });
    }

    beforeEach(() => {
      vi.mocked(createOpenAICompatible).mockReturnValue({} as unknown as OpenAICompatibleProvider);
    });

    test('publishes envoy on the requested address and port and keeps the router api on loopback', async () => {
      withListener({ address: '192.168.1.10', port: 8899 });

      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

      expect(net.getFreePort).toHaveBeenNthCalledWith(1, 8899);
      expect(net.getFreePort).toHaveBeenNthCalledWith(2, 8900);
      expect(dockerodeMock.createContainer).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            PortBindings: {
              '8801/tcp': [{ HostIp: '192.168.1.10', HostPort: '8899' }],
              '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8900' }],
            },
          }),
        }),
      );
      expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ endpoint: 'http://192.168.1.10:8899/v1' }),
      );
    });

    test.each([
      ['0.0.0.0', 'http://localhost:8899/v1'],
      ['127.0.0.1', 'http://localhost:8899/v1'],
      ['::', 'http://localhost:8899/v1'],
      ['fd00::10', 'http://[fd00::10]:8899/v1'],
    ])('registers the endpoint reachable for listener address %s', async (address, endpoint) => {
      withListener({ address, port: 8899 });

      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

      expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ endpoint }),
      );
    });

    test('rejects a requested port that is already in use without side effects', async () => {
      withListener({ address: '127.0.0.1', port: 8899 });
      vi.mocked(net.getFreePort).mockResolvedValue(8900);

      await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
        'Port 8899 is already in use',
      );

      expect(mkdir).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(dockerodeMock.createContainer).not.toHaveBeenCalled();
    });

    test('uses the listener address of a discovered router for its endpoint', async () => {
      dockerodeMock.listContainers.mockResolvedValue([
        {
          Id: 'existing-router',
          Labels: { [SemanticRouterLabel.NAME]: 'existing', [SemanticRouterLabel.ROLE]: 'router' },
          State: 'running',
        },
        {
          Id: 'existing-envoy',
          Labels: { [SemanticRouterLabel.NAME]: 'existing', [SemanticRouterLabel.ROLE]: 'envoy' },
          State: 'running',
        },
      ]);
      dockerodeMock.getContainer.mockReturnValue({
        ...routerContainerMock,
        inspect: vi.fn().mockResolvedValue({
          HostConfig: {
            PortBindings: {
              '8801/tcp': [{ HostIp: '192.168.1.10', HostPort: '8899' }],
              '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8900' }],
            },
          },
        }),
      });
      vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats);

      await manager.init();

      expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ endpoint: 'http://192.168.1.10:8899/v1' }),
      );
    });
  });

  test('create fails without creating containers when no free port is available', async () => {
    vi.mocked(net.getFreePort).mockRejectedValue(new Error('Unable to find a free port'));

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'Unable to find a free port',
    );
    expect(dockerodeMock.createContainer).not.toHaveBeenCalled();
  });

  test('create validates the name and the configuration and writes the generated envoy config', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
    const config = stringify(defaultConfig);

    await manager.create({ name: 'my-router', config });

    expect(SemanticRouterConfigParser.prototype.validateName).toHaveBeenCalledWith('my-router');
    expect(SemanticRouterConfigParser.prototype.parseConfig).toHaveBeenCalledWith(config);
    expect(EnvoyConfigGenerator.prototype.generate).toHaveBeenCalledWith(PARSED_CONFIG);
    expect(writeFile).toHaveBeenCalledWith(
      path.join(STORAGE_PATH, 'configs', 'my-router', 'config.yaml'),
      config,
      'utf-8',
    );
    expect(writeFile).toHaveBeenCalledWith(ENVOY_CONFIG_PATH, GENERATED_ENVOY_CONFIG, 'utf-8');
  });

  // nothing must be looked up, written, pulled or created before the input is validated
  function expectNoSideEffects(): void {
    expect(containerExtensionAPIMock.getEndpoints).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(ImageHelper.prototype.ensureImage).not.toHaveBeenCalled();
    expect(dockerodeMock.createContainer).not.toHaveBeenCalled();
  }

  test('create rejects an invalid name without side effects', async () => {
    vi.mocked(SemanticRouterConfigParser.prototype.validateName).mockImplementation(() => {
      throw new Error('invalid name');
    });

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'invalid name',
    );

    expectNoSideEffects();
  });

  test('create rejects an invalid configuration without side effects', async () => {
    vi.mocked(SemanticRouterConfigParser.prototype.parseConfig).mockImplementation(() => {
      throw new Error('invalid configuration');
    });

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'invalid configuration',
    );

    expectNoSideEffects();
  });

  test('create throws when no container engine is available', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await expect(manager.create({ name: 'no-engine', config: stringify(defaultConfig) })).rejects.toThrow(
      'No container engine available',
    );
  });

  test('create uses the name as connection id and creates its config folder', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    const result = await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    expect(result).toEqual({ connectionId: 'my-router' });
    expect(mkdir).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs'), { recursive: true });
    expect(mkdir).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs', 'my-router'));
    expect(providerMock.registerInferenceProviderConnection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'my-router' }),
    );
  });

  test('create rejects when the config folder already exists', async () => {
    vi.mocked(mkdir)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }));

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      `A semantic router named 'my-router' already exists`,
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(dockerodeMock.createContainer).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  test('create propagates other errors when creating the config folder', async () => {
    vi.mocked(mkdir)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'EACCES: permission denied',
    );
    expect(dockerodeMock.createContainer).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  describe('images', () => {
    const loggerMock = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

    beforeEach(() => {
      vi.mocked(createOpenAICompatible).mockReturnValue({} as unknown as OpenAICompatibleProvider);
    });

    test('create ensures the router image, then the envoy image, with the logger', async () => {
      await manager.create({ name: 'my-router', config: stringify(defaultConfig) }, loggerMock);

      expect(ImageHelper.prototype.ensureImage).toHaveBeenNthCalledWith(
        1,
        dockerodeMock,
        SemanticRouterImage.ROUTER,
        loggerMock,
      );
      expect(ImageHelper.prototype.ensureImage).toHaveBeenNthCalledWith(
        2,
        dockerodeMock,
        SemanticRouterImage.ENVOY,
        loggerMock,
      );
    });

    test('create reports failures to the logger', async () => {
      vi.mocked(ImageHelper.prototype.ensureImage).mockRejectedValue(new Error('offline'));

      await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) }, loggerMock)).rejects.toThrow(
        'offline',
      );

      expect(loggerMock.error).toHaveBeenCalledWith(
        `Failed to create semantic router 'my-router':`,
        expect.objectContaining({ message: 'offline' }),
      );
    });

    test('factory create forwards the logger', async () => {
      await manager.init();
      const factory = vi.mocked(providerMock.setSemanticRouterConnectionFactory).mock.calls[0]?.[0];
      assert(factory);

      await factory.create({ name: 'my-router', config: stringify(defaultConfig) }, loggerMock);

      expect(ImageHelper.prototype.ensureImage).toHaveBeenCalledWith(
        dockerodeMock,
        SemanticRouterImage.ROUTER,
        loggerMock,
      );
    });
  });

  test('create removes the config folder when container creation fails', async () => {
    vi.mocked(ImageHelper.prototype.ensureImage).mockRejectedValue(new Error('pull failed'));

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'pull failed',
    );
    expect(rm).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs', 'my-router'), {
      recursive: true,
      force: true,
    });
    expect(providerMock.registerInferenceProviderConnection).not.toHaveBeenCalled();
    expect(routerRemoveMock).not.toHaveBeenCalled();
    expect(envoyRemoveMock).not.toHaveBeenCalled();
  });

  test('create removes the router container and config folder when envoy creation fails', async () => {
    dockerodeMock.createContainer.mockReset();
    dockerodeMock.createContainer
      .mockResolvedValueOnce(routerContainerMock)
      .mockRejectedValueOnce(new Error('envoy create failed'));

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'envoy create failed',
    );
    expect(routerRemoveMock).toHaveBeenCalledWith({ force: true });
    expect(envoyRemoveMock).not.toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs', 'my-router'), {
      recursive: true,
      force: true,
    });
  });

  test('create removes both containers when registering the connection fails', async () => {
    vi.mocked(providerMock.registerInferenceProviderConnection).mockImplementation(() => {
      throw new Error('registration failed');
    });

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'registration failed',
    );
    expect(routerRemoveMock).toHaveBeenCalledWith({ force: true });
    expect(envoyRemoveMock).toHaveBeenCalledWith({ force: true });
    // envoy uses the router network namespace, so it must be removed first
    const [envoyRemoveOrder] = envoyRemoveMock.mock.invocationCallOrder;
    const [routerRemoveOrder] = routerRemoveMock.mock.invocationCallOrder;
    assert(envoyRemoveOrder !== undefined && routerRemoveOrder !== undefined);
    expect(envoyRemoveOrder).toBeLessThan(routerRemoveOrder);
  });

  test('create still removes the config folder and rethrows when a container cannot be removed', async () => {
    dockerodeMock.createContainer.mockReset();
    dockerodeMock.createContainer
      .mockResolvedValueOnce(routerContainerMock)
      .mockRejectedValueOnce(new Error('envoy create failed'));
    routerRemoveMock.mockRejectedValue(new Error('remove failed'));

    await expect(manager.create({ name: 'my-router', config: stringify(defaultConfig) })).rejects.toThrow(
      'envoy create failed',
    );
    expect(rm).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs', 'my-router'), {
      recursive: true,
      force: true,
    });
  });

  test('lifecycle.start starts router then envoy and updates status', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    expect(registeredConnection.status()).toBe('stopped');

    assert(registeredConnection.lifecycle);
    assert(registeredConnection.lifecycle.start);
    await registeredConnection.lifecycle.start({} as never, {} as never);

    expect(routerStartMock).toHaveBeenCalled();
    expect(envoyStartMock).toHaveBeenCalled();
    const routerStartOrder = routerStartMock.mock.invocationCallOrder[0];
    const envoyStartOrder = envoyStartMock.mock.invocationCallOrder[0];
    expect(routerStartOrder).toBeLessThan(envoyStartOrder);
    expect(registeredConnection.status()).toBe('started');
  });

  test('lifecycle.stop stops envoy then router and updates status', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'my-router', config: stringify(defaultConfig) });

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    assert(registeredConnection.lifecycle);
    assert(registeredConnection.lifecycle.start);
    await registeredConnection.lifecycle.start({} as never, {} as never);
    expect(registeredConnection.status()).toBe('started');

    assert(registeredConnection.lifecycle.stop);
    await registeredConnection.lifecycle.stop({} as never, {} as never);

    expect(envoyStopMock).toHaveBeenCalled();
    expect(routerStopMock).toHaveBeenCalled();
    const envoyStopOrder = envoyStopMock.mock.invocationCallOrder[0];
    const routerStopOrder = routerStopMock.mock.invocationCallOrder[0];
    expect(envoyStopOrder).toBeLessThan(routerStopOrder);
    expect(registeredConnection.status()).toBe('stopped');
  });

  describe('container changes', () => {
    const containerInfo = (id: string, state: string): unknown => ({ Id: id, State: state, Labels: {} });

    async function createConnection(): Promise<{
      connection: Parameters<typeof providerMock.registerInferenceProviderConnection>[0];
      onContainersChanged: () => unknown;
    }> {
      await manager.init();
      vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });
      const connection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
      const onContainersChanged = vi.mocked(containerExtensionAPIMock.onContainersChanged).mock.calls[0]?.[0];
      assert(connection);
      assert(onContainersChanged);
      // the listener returns the refresh promise
      return { connection, onContainersChanged: (): unknown => onContainersChanged() };
    }

    test.each([
      { router: 'running', envoy: 'running', status: 'started' },
      { router: 'running', envoy: 'exited', status: 'stopped' },
      { router: 'exited', envoy: 'running', status: 'stopped' },
      { router: 'exited', envoy: 'exited', status: 'stopped' },
    ])('reports $status when the router is $router and envoy is $envoy', async ({ router, envoy, status }) => {
      const { connection, onContainersChanged } = await createConnection();
      dockerodeMock.listContainers.mockResolvedValue([
        containerInfo('router-container-id', router),
        containerInfo('envoy-container-id', envoy),
      ]);

      onContainersChanged();

      await vi.waitFor(() => expect(connection.status()).toBe(status));
      expect(connectionDisposable.dispose).not.toHaveBeenCalled();
    });

    test('marks a started connection stopped when envoy is stopped outside of the extension', async () => {
      const { connection, onContainersChanged } = await createConnection();
      assert(connection.lifecycle?.start);
      await connection.lifecycle.start({} as never, {} as never);
      expect(connection.status()).toBe('started');
      dockerodeMock.listContainers.mockResolvedValue([
        containerInfo('router-container-id', 'running'),
        containerInfo('envoy-container-id', 'exited'),
      ]);

      onContainersChanged();

      await vi.waitFor(() => expect(connection.status()).toBe('stopped'));
    });

    test.each([
      'router-container-id',
      'envoy-container-id',
    ])('unregisters the connection when container %s is removed', async remainingId => {
      const { onContainersChanged } = await createConnection();
      dockerodeMock.listContainers.mockResolvedValue([containerInfo(remainingId, 'running')]);

      onContainersChanged();

      await vi.waitFor(() => expect(connectionDisposable.dispose).toHaveBeenCalledOnce());
      // no longer tracked: dispose() does not dispose it again
      manager.dispose();
      expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
    });

    test('keeps the connection when listing containers fails', async () => {
      const { connection, onContainersChanged } = await createConnection();
      dockerodeMock.listContainers.mockRejectedValue(new Error('engine unavailable'));

      onContainersChanged();

      await vi.waitFor(() => expect(dockerodeMock.listContainers).toHaveBeenCalledTimes(2));
      expect(connectionDisposable.dispose).not.toHaveBeenCalled();
      expect(connection.status()).toBe('stopped');
    });

    test('does not drop a connection registered while a refresh is listing containers', async () => {
      const { promise: listing, resolve: finishListing } = Promise.withResolvers<unknown[]>();
      const { connection, onContainersChanged } = await createConnection();
      dockerodeMock.listContainers.mockReturnValueOnce(listing);

      const refreshing = onContainersChanged();
      // the router is deleted and recreated with the same name while the refresh waits for the engine
      assert(connection.lifecycle?.delete);
      await connection.lifecycle.delete();
      dockerodeMock.createContainer
        .mockResolvedValueOnce(routerContainerMock)
        .mockResolvedValueOnce(envoyContainerMock);
      vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
      const recreatedDisposable = { dispose: vi.fn() };
      vi.mocked(providerMock.registerInferenceProviderConnection).mockReturnValueOnce(recreatedDisposable);
      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });
      finishListing([]);
      await refreshing;

      expect(recreatedDisposable.dispose).not.toHaveBeenCalled();
      // still tracked: dispose() disposes it
      manager.dispose();
      expect(recreatedDisposable.dispose).toHaveBeenCalledOnce();
    });
  });

  describe('readiness on start', () => {
    const loggerMock = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

    async function createStoppedConnection(): Promise<
      Parameters<typeof providerMock.registerInferenceProviderConnection>[0]
    > {
      vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });
      const connection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
      assert(connection?.lifecycle?.start);
      return connection;
    }

    test('starts both containers, then waits for the router api /ready before reporting started', async () => {
      const { promise: ready, resolve: becomeReady } = Promise.withResolvers<void>();
      vi.mocked(NetworkHelper.prototype.waitForHttpOk).mockReturnValue(ready);
      const connection = await createStoppedConnection();
      assert(connection.lifecycle?.start);

      const starting = connection.lifecycle.start({} as never, loggerMock);

      await vi.waitFor(() => expect(NetworkHelper.prototype.waitForHttpOk).toHaveBeenCalled());
      expect(NetworkHelper.prototype.waitForHttpOk).toHaveBeenCalledWith('http://127.0.0.1:50002/ready', {
        timeout: 120_000,
        interval: 10_000,
        onNotReady: expect.any(Function),
      });
      const [waitOrder] = vi.mocked(NetworkHelper.prototype.waitForHttpOk).mock.invocationCallOrder;
      const [routerStartOrder] = routerStartMock.mock.invocationCallOrder;
      const [envoyStartOrder] = envoyStartMock.mock.invocationCallOrder;
      assert(waitOrder !== undefined && routerStartOrder !== undefined && envoyStartOrder !== undefined);
      expect(routerStartOrder).toBeLessThan(envoyStartOrder);
      expect(envoyStartOrder).toBeLessThan(waitOrder);
      expect(connection.status()).toBe('starting');

      becomeReady();
      await starting;

      expect(connection.status()).toBe('started');
    });

    test('stops both containers and stays stopped when the router does not become ready', async () => {
      vi.mocked(NetworkHelper.prototype.waitForHttpOk).mockRejectedValue(new Error('Timed out'));
      const connection = await createStoppedConnection();
      assert(connection.lifecycle?.start);

      await expect(connection.lifecycle.start({} as never, loggerMock)).rejects.toThrow('Timed out');

      expect(envoyStopMock).toHaveBeenCalled();
      expect(routerStopMock).toHaveBeenCalled();
      const [envoyStopOrder] = envoyStopMock.mock.invocationCallOrder;
      const [routerStopOrder] = routerStopMock.mock.invocationCallOrder;
      assert(envoyStopOrder !== undefined && routerStopOrder !== undefined);
      expect(envoyStopOrder).toBeLessThan(routerStopOrder);
      expect(connection.status()).toBe('stopped');
    });

    test('keeps reporting starting when containers change while waiting', async () => {
      const { promise: ready, resolve: becomeReady } = Promise.withResolvers<void>();
      vi.mocked(NetworkHelper.prototype.waitForHttpOk).mockReturnValue(ready);
      await manager.init();
      const connection = await createStoppedConnection();
      assert(connection.lifecycle?.start);
      const onContainersChanged = vi.mocked(containerExtensionAPIMock.onContainersChanged).mock.calls[0]?.[0];
      assert(onContainersChanged);
      const starting = connection.lifecycle.start({} as never, loggerMock);
      await vi.waitFor(() => expect(NetworkHelper.prototype.waitForHttpOk).toHaveBeenCalled());
      dockerodeMock.listContainers.mockResolvedValue([
        { Id: 'router-container-id', State: 'running', Labels: {} },
        { Id: 'envoy-container-id', State: 'running', Labels: {} },
      ]);

      await onContainersChanged();

      expect(connection.status()).toBe('starting');
      becomeReady();
      await starting;
      expect(connection.status()).toBe('started');
    });

    test('reports the router startup progress to the logger once per change', async () => {
      const connection = await createStoppedConnection();
      assert(connection.lifecycle?.start);
      await connection.lifecycle.start({} as never, loggerMock);
      const options = vi.mocked(NetworkHelper.prototype.waitForHttpOk).mock.calls[0]?.[1];
      assert(options?.onNotReady);
      const notReady = (body: unknown): Response => new Response(JSON.stringify(body), { status: 503 });

      await options.onNotReady(notReady({ phase: 'loading', message: 'loading models' }));
      await options.onNotReady(notReady({ phase: 'loading', message: 'loading models' }));
      await options.onNotReady(notReady({ phase: 'loading', downloading_model: 'org/model' }));
      await options.onNotReady(notReady({ phase: 'warming' }));
      await options.onNotReady(new Response('not json', { status: 503 }));
      await options.onNotReady(notReady({ message: 42 }));

      expect(loggerMock.log.mock.calls.map(c => c[0])).toEqual([
        "Semantic router 'my-router' is starting: loading models",
        "Semantic router 'my-router' is starting: downloading model org/model",
        "Semantic router 'my-router' is starting: warming",
      ]);
    });

    test('polls the router api port of a discovered router', async () => {
      dockerodeMock.listContainers.mockResolvedValue([
        {
          Id: 'existing-router',
          Labels: { [SemanticRouterLabel.NAME]: 'existing', [SemanticRouterLabel.ROLE]: 'router' },
          State: 'exited',
        },
        {
          Id: 'existing-envoy',
          Labels: { [SemanticRouterLabel.NAME]: 'existing', [SemanticRouterLabel.ROLE]: 'envoy' },
          State: 'exited',
        },
      ]);
      dockerodeMock.getContainer.mockReturnValue({
        ...routerContainerMock,
        inspect: vi.fn().mockResolvedValue({
          HostConfig: { PortBindings: { '8801/tcp': [{ HostPort: '8888' }], '8080/tcp': [{ HostPort: '8889' }] } },
        }),
      });
      vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as Stats);
      await manager.init();
      const connection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
      assert(connection?.lifecycle?.start);

      await connection.lifecycle.start({} as never, loggerMock);

      expect(NetworkHelper.prototype.waitForHttpOk).toHaveBeenCalledWith(
        'http://127.0.0.1:8889/ready',
        expect.objectContaining({ timeout: 120_000 }),
      );
    });
  });

  describe('lifecycle.start failures', () => {
    async function createStoppedConnection(): Promise<
      Parameters<typeof providerMock.registerInferenceProviderConnection>[0]
    > {
      vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });
      const connection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
      assert(connection?.lifecycle?.start);
      expect(connection.status()).toBe('stopped');
      return connection;
    }

    test('stops the router again and stays stopped when envoy fails to start', async () => {
      const connection = await createStoppedConnection();
      envoyStartMock.mockRejectedValue(Object.assign(new Error('envoy start failed'), { statusCode: 500 }));
      assert(connection.lifecycle?.start);

      await expect(connection.lifecycle.start({} as never, {} as never)).rejects.toThrow('envoy start failed');

      expect(routerStartMock).toHaveBeenCalled();
      expect(routerStopMock).toHaveBeenCalled();
      expect(envoyStopMock).not.toHaveBeenCalled();
      expect(connection.status()).toBe('stopped');
    });

    test('does not start envoy when the router fails to start', async () => {
      const connection = await createStoppedConnection();
      routerStartMock.mockRejectedValue(new Error('router start failed'));
      assert(connection.lifecycle?.start);

      await expect(connection.lifecycle.start({} as never, {} as never)).rejects.toThrow('router start failed');

      expect(envoyStartMock).not.toHaveBeenCalled();
      expect(routerStopMock).not.toHaveBeenCalled();
      expect(connection.status()).toBe('stopped');
    });

    test('rethrows the start error when rolling back fails', async () => {
      const connection = await createStoppedConnection();
      envoyStartMock.mockRejectedValue(new Error('envoy start failed'));
      routerStopMock.mockRejectedValue(new Error('router stop failed'));
      assert(connection.lifecycle?.start);

      await expect(connection.lifecycle.start({} as never, {} as never)).rejects.toThrow('envoy start failed');

      expect(connection.status()).toBe('stopped');
    });

    test.each([
      { already: 'the router', routerError: true, envoyError: false },
      { already: 'envoy', routerError: false, envoyError: true },
      { already: 'both containers', routerError: true, envoyError: true },
    ])('treats $already already started as started', async ({ routerError, envoyError }) => {
      const connection = await createStoppedConnection();
      const alreadyStarted = Object.assign(new Error('container already started'), { statusCode: 304 });
      if (routerError) routerStartMock.mockRejectedValue(alreadyStarted);
      if (envoyError) envoyStartMock.mockRejectedValue(alreadyStarted);
      assert(connection.lifecycle?.start);

      await expect(connection.lifecycle.start({} as never, {} as never)).resolves.toBeUndefined();

      expect(routerStartMock).toHaveBeenCalled();
      expect(envoyStartMock).toHaveBeenCalled();
      expect(routerStopMock).not.toHaveBeenCalled();
      expect(connection.status()).toBe('started');
    });
  });

  describe('lifecycle.stop failures', () => {
    async function createStartedConnection(): Promise<
      Parameters<typeof providerMock.registerInferenceProviderConnection>[0]
    > {
      vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
      await manager.create({ name: 'my-router', config: stringify(defaultConfig) });
      const connection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
      assert(connection?.lifecycle?.start);
      await connection.lifecycle.start({} as never, {} as never);
      expect(connection.status()).toBe('started');
      return connection;
    }

    test.each([
      { failing: 'envoy', stopMock: envoyStopMock, otherStopMock: routerStopMock },
      { failing: 'router', stopMock: routerStopMock, otherStopMock: envoyStopMock },
    ])('stops the other container and marks the connection stopped when $failing fails', async ({
      stopMock,
      otherStopMock,
    }) => {
      const connection = await createStartedConnection();
      stopMock.mockRejectedValue(Object.assign(new Error('stop failed'), { statusCode: 500 }));
      assert(connection.lifecycle?.stop);

      const error = await connection.lifecycle.stop({} as never, {} as never).catch((err: unknown) => err);

      expect(otherStopMock).toHaveBeenCalled();
      expect(connection.status()).toBe('stopped');
      assert(error instanceof AggregateError);
      expect(error.message).toBe(`Failed to stop semantic router 'my-router'`);
      expect(error.errors).toEqual([expect.objectContaining({ message: 'stop failed' })]);
    });

    test('reports both errors when both containers fail to stop', async () => {
      const connection = await createStartedConnection();
      envoyStopMock.mockRejectedValue(new Error('envoy stop failed'));
      routerStopMock.mockRejectedValue(new Error('router stop failed'));
      assert(connection.lifecycle?.stop);

      const error = await connection.lifecycle.stop({} as never, {} as never).catch((err: unknown) => err);

      expect(connection.status()).toBe('stopped');
      assert(error instanceof AggregateError);
      expect(error.errors).toHaveLength(2);
    });

    test('treats an already stopped container as stopped', async () => {
      const connection = await createStartedConnection();
      envoyStopMock.mockRejectedValue(Object.assign(new Error('container already stopped'), { statusCode: 304 }));
      assert(connection.lifecycle?.stop);

      await expect(connection.lifecycle.stop({} as never, {} as never)).resolves.toBeUndefined();

      expect(routerStopMock).toHaveBeenCalled();
      expect(connection.status()).toBe('stopped');
    });
  });

  test('lifecycle.delete stops and removes both containers', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);

    await manager.create({ name: 'delete-me', config: stringify({ ...defaultConfig, name: 'delete-me' }) });

    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]![0];
    assert(registeredConnection.lifecycle);
    assert(registeredConnection.lifecycle.delete);
    await registeredConnection.lifecycle.delete();

    expect(routerStopMock).toHaveBeenCalled();
    expect(routerRemoveMock).toHaveBeenCalled();
    expect(envoyStopMock).toHaveBeenCalled();
    expect(envoyRemoveMock).toHaveBeenCalled();
    expect(connectionDisposable.dispose).toHaveBeenCalled();
  });

  test('lifecycle.delete unregisters the connection even when the config folder cannot be removed', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
    await manager.create({ name: 'delete-me', config: stringify({ ...defaultConfig, name: 'delete-me' }) });
    const registeredConnection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
    assert(registeredConnection?.lifecycle?.delete);
    vi.mocked(rm).mockRejectedValue(new Error('EBUSY: resource busy'));

    await expect(registeredConnection.lifecycle.delete()).rejects.toThrow('EBUSY: resource busy');

    expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
    // the connection is no longer tracked, so dispose() does not dispose it again
    manager.dispose();
    expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
  });

  describe('lifecycle.delete failures', () => {
    const httpError = (statusCode: number): Error => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

    async function createConnection(): Promise<Parameters<typeof providerMock.registerInferenceProviderConnection>[0]> {
      vi.mocked(createOpenAICompatible).mockReturnValueOnce({} as unknown as OpenAICompatibleProvider);
      await manager.create({ name: 'delete-me', config: stringify({ ...defaultConfig, name: 'delete-me' }) });
      const connection = vi.mocked(providerMock.registerInferenceProviderConnection).mock.calls[0]?.[0];
      assert(connection?.lifecycle?.delete);
      return connection;
    }

    test('keeps the folder and the connection and reports the error when a container cannot be removed', async () => {
      const connection = await createConnection();
      routerRemoveMock.mockRejectedValue(httpError(500));
      assert(connection.lifecycle?.delete);

      const error = await connection.lifecycle.delete().catch((err: unknown) => err);

      assert(error instanceof AggregateError);
      expect(error.message).toBe("Failed to delete semantic router 'delete-me'");
      expect(error.errors).toEqual([expect.objectContaining({ statusCode: 500 })]);
      // the other container is still removed
      expect(envoyRemoveMock).toHaveBeenCalled();
      expect(rm).not.toHaveBeenCalled();
      expect(connectionDisposable.dispose).not.toHaveBeenCalled();
      // still tracked: dispose() disposes it
      manager.dispose();
      expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
    });

    test('reports both errors when no container can be removed', async () => {
      const connection = await createConnection();
      envoyRemoveMock.mockRejectedValue(httpError(500));
      routerRemoveMock.mockRejectedValue(httpError(409));
      assert(connection.lifecycle?.delete);

      const error = await connection.lifecycle.delete().catch((err: unknown) => err);

      assert(error instanceof AggregateError);
      expect(error.errors).toHaveLength(2);
    });

    test('can be retried after a failed removal', async () => {
      const connection = await createConnection();
      routerRemoveMock.mockRejectedValueOnce(httpError(500));
      assert(connection.lifecycle?.delete);
      await expect(connection.lifecycle.delete()).rejects.toThrow("Failed to delete semantic router 'delete-me'");

      await expect(connection.lifecycle.delete()).resolves.toBeUndefined();

      expect(rm).toHaveBeenCalledWith(path.join(STORAGE_PATH, 'configs', 'delete-me'), {
        recursive: true,
        force: true,
      });
      expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
    });

    test('treats a container that is already removed as removed', async () => {
      const connection = await createConnection();
      envoyStopMock.mockRejectedValue(httpError(404));
      envoyRemoveMock.mockRejectedValue(httpError(404));
      assert(connection.lifecycle?.delete);

      await expect(connection.lifecycle.delete()).resolves.toBeUndefined();

      expect(rm).toHaveBeenCalled();
      expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
    });

    test.each([304, 500])('still removes a container whose stop fails with %s', async statusCode => {
      const connection = await createConnection();
      routerStopMock.mockRejectedValue(httpError(statusCode));
      assert(connection.lifecycle?.delete);

      await expect(connection.lifecycle.delete()).resolves.toBeUndefined();

      expect(routerRemoveMock).toHaveBeenCalled();
      expect(connectionDisposable.dispose).toHaveBeenCalledOnce();
    });
  });

  test('dispose cleans up factory and all connection registrations', async () => {
    vi.mocked(createOpenAICompatible).mockReturnValue({} as unknown as OpenAICompatibleProvider);

    await manager.init();
    await manager.create({ name: 'dispose-router', config: stringify({ ...defaultConfig, name: 'dispose-router' }) });

    manager.dispose();

    expect(factoryDisposable.dispose).toHaveBeenCalled();
    expect(connectionDisposable.dispose).toHaveBeenCalled();
    expect(endpointsSubscription.dispose).toHaveBeenCalled();
    expect(containersSubscription.dispose).toHaveBeenCalled();
  });
});
