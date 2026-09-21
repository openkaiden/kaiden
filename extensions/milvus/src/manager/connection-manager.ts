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
import { randomInt } from 'node:crypto';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Disposable,
  ExtensionContext,
  LifecycleContext,
  Logger,
  Provider,
  ProviderConnectionLifecycle,
  RagProviderConnectionFactory,
} from '@openkaiden/api';
import type { EndpointConnection } from '@openkaiden/container-extension-api';
import { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
import { sanitizeContainerName } from '@openkaiden/container-extension-api/container-name';
// eslint-disable-next-line import/no-extraneous-dependencies
import Dockerode from 'dockerode';
import { inject, injectable } from 'inversify';

import { ConfigHelper } from '/@/util/config';

import { MilvusConnection } from '../api/milvus-connection';
import { MilvusContainer } from '../api/milvus-container';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, MilvusProvider } from '../inject/symbol';

const MILVUS_IMAGE = 'docker.io/milvusdb/milvus:v2.6.3';
const MILVUS_PORT = 19530;

type ConnectionEntry = {
  connection: MilvusConnection;
  disposable: Disposable;
};

function getRandomPort(): number {
  return randomInt(1024, 65536);
}

@injectable()
export class ConnectionManager implements Disposable {
  @inject(ExtensionContextSymbol)
  private extensionContext!: ExtensionContext;

  @inject(ContainerExtensionAPISymbol)
  private containerExtensionAPI!: ContainerExtensionAPI;

  @inject(MilvusProvider)
  private milvusProvider!: Provider;

  @inject(ConfigHelper)
  private configHelper!: ConfigHelper;

  #connections: Map<string, ConnectionEntry> = new Map();
  #factoryDisposable: Disposable | undefined;

  registerConnection(container: MilvusContainer): void {
    const connectionEntry = this.#connections.get(`${container.path}::${container.id}`);
    if (connectionEntry !== undefined) {
      connectionEntry.connection.updateStatus(container.running ? 'started' : 'stopped');
    } else {
      const connection = new MilvusConnection(
        container.path,
        container.name,
        container.id,
        container.port,
        container.running,
      );
      const lifecycle: ProviderConnectionLifecycle = {
        start: this.startConnection.bind(this, connection),
        stop: this.stopConnection.bind(this, connection),
        delete: this.deleteConnection.bind(this, connection),
      };
      connection.lifecycle = lifecycle;
      const disposable = this.milvusProvider.registerRagProviderConnection(connection);
      this.#connections.set(`${container.path}::${container.id}`, { connection, disposable });
    }
  }

  private getContainer(connection: MilvusConnection): Dockerode.Container | undefined {
    const entry = this.#connections.get(`${connection.path}::${connection.containerId}`);
    if (entry !== undefined) {
      const dockerode = this.containerExtensionAPI
        .getEndpoints()
        .find(endpoint => endpoint.path === connection.path)?.dockerode;
      if (dockerode) {
        return dockerode.getContainer(connection.containerId);
      }
    }
  }

  async startConnection(connection: MilvusConnection, startContext: LifecycleContext): Promise<void> {
    const container = this.getContainer(connection);
    if (container) {
      await container.start();
      return connection.start(startContext);
    }
  }

  async stopConnection(connection: MilvusConnection, stopContext: LifecycleContext): Promise<void> {
    const container = this.getContainer(connection);
    if (container) {
      await container.stop();
      return connection.stop(stopContext);
    }
  }

  async deleteConnection(connection: MilvusConnection, _logger?: Logger): Promise<void> {
    const container = this.getContainer(connection);
    if (container) {
      await container.remove();
    }
    const entry = this.#connections.get(`${connection.path}::${connection.containerId}`);
    if (entry !== undefined) {
      entry.disposable.dispose();
      this.#connections.delete(`${connection.path}::${connection.containerId}`);
      const path = join(this.extensionContext.storagePath, entry.connection.name);
      await rm(path, { recursive: true, force: true });
    }
  }

  dispose(): void {
    this.#connections.forEach((entry, _key) => entry.disposable.dispose());
    this.#connections.clear();
    this.#factoryDisposable?.dispose();
    this.#factoryDisposable = undefined;
  }

  async discoverExistingContainers(): Promise<void> {
    try {
      const existingContainers = Array.from(this.#connections.keys());
      for (const endpoint of this.containerExtensionAPI.getEndpoints()) {
        const containers = await endpoint.dockerode.listContainers({ all: true });
        for (const container of containers) {
          const milvusName = container.Labels?.['ai.openkaiden.milvus.name'];
          const milvusPort = container.Labels?.['ai.openkaiden.milvus.port'];

          if (milvusName && milvusPort) {
            this.registerConnection({
              path: endpoint.path,
              id: container.Id,
              name: milvusName,
              port: parseInt(milvusPort, 10),
              running: container.State === 'running',
            });
            const idx = existingContainers.indexOf(`${endpoint.path}::${container.Id}`);
            if (idx >= 0) {
              existingContainers.splice(idx, 1);
            }
          }
        }
      }
      for (const key of existingContainers) {
        const entry = this.#connections.get(key);
        if (entry !== undefined) {
          entry.disposable.dispose();
          this.#connections.delete(key);
        }
      }
    } catch (err: unknown) {
      console.error(`Failed to discover containers: ${err}`);
    }
  }

  async init(): Promise<void> {
    this.containerExtensionAPI.onContainersChanged(this.discoverExistingContainers.bind(this));
    this.containerExtensionAPI.onEndpointsChanged(this.handleEndpointsChanged.bind(this));

    // If there are container endpoints available, register the factory right away
    if (this.containerExtensionAPI.getEndpoints().length > 0) {
      this.registerFactory();
      await this.discoverExistingContainers();
    }
  }

  handleEndpointsChanged(endpoints: readonly EndpointConnection[]): void {
    if (endpoints.length > 0 && !this.#factoryDisposable) {
      // Container endpoints appeared — register the factory and discover existing containers
      this.registerFactory();
      this.discoverExistingContainers().catch((err: unknown) => {
        console.error(`Failed to discover containers after endpoints changed: ${err}`);
      });
    } else if (endpoints.length === 0 && this.#factoryDisposable) {
      // All container endpoints gone — unregister connections and factory
      this.#connections.forEach((entry, _key) => entry.disposable.dispose());
      this.#connections.clear();
      this.#factoryDisposable.dispose();
      this.#factoryDisposable = undefined;
    }
  }

  private registerFactory(): void {
    const ragFactory: RagProviderConnectionFactory = {
      creationDisplayName: 'Milvus Vector Database',
      create: this.factory.bind(this),
    };
    this.#factoryDisposable = this.milvusProvider.setRagProviderConnectionFactory(ragFactory);
  }

  private async checkMilvusImage(dockerode: Dockerode, logger?: Logger): Promise<boolean> {
    logger?.log(`Checking if Milvus image ${MILVUS_IMAGE} is available...`);
    try {
      await dockerode.getImage(MILVUS_IMAGE).inspect();
      return true;
    } catch (err) {
      return false;
    }
  }

  private async pullMilvusImage(dockerode: Dockerode, logger?: Logger): Promise<void> {
    logger?.log(`Pulling Milvus image ${MILVUS_IMAGE}...`);
    const promise = Promise.withResolvers<void>();
    try {
      const stream = await dockerode.pull(MILVUS_IMAGE);
      const onFinished = (err: Error | null): void => {
        if (err) {
          promise.reject(err);
          return;
        }
        promise.resolve();
      };
      dockerode.modem.followProgress(stream, onFinished, (): void => {});
    } catch (err: unknown) {
      console.error(`Failed to pull Milvus image ${MILVUS_IMAGE}: ${err}`);
      promise.reject(err);
    }
    return promise.promise;
  }

  async factory(params: { [key: string]: unknown }, logger?: Logger): Promise<void> {
    logger?.log('Creating Milvus RAG connection...');

    const name = params['milvus.name'] as string;
    if (!name) {
      throw new Error('Name parameter is required');
    }

    logger?.log(`Connection name: ${name}`);

    let safeName = sanitizeContainerName(name);

    const containerConnection = this.containerExtensionAPI.getEndpoints()[0];
    if (!containerConnection) {
      throw new Error('No container endpoint available');
    }
    const dockerode = containerConnection.dockerode;

    // Ensure both container name and storage directory are unique
    const existingContainers = await dockerode.listContainers({ all: true });
    const existingNames = new Set(existingContainers.flatMap(c => c.Names ?? []));
    const storageRoot = this.extensionContext.storagePath;
    const baseSafeName = safeName;
    let suffix = 1;
    while (true) {
      const storageExists = await access(join(storageRoot, safeName)).then(
        () => true,
        () => false,
      );
      if (!existingNames.has(`/milvus-${safeName}`) && !storageExists) {
        break;
      }
      suffix++;
      safeName = `${baseSafeName}-${suffix}`;
    }

    const storagePath = join(storageRoot, safeName);
    logger?.log(`Storage path: ${storagePath}`);

    await mkdir(storagePath, { recursive: true });
    const { etcdConfigFile, userConfigFile } = await this.configHelper.createConfigFile(storagePath);
    const containerName = `milvus-${safeName}`;

    logger?.log('Using podman CLI to create container...');
    const isImageAvailable = await this.checkMilvusImage(dockerode, logger);
    if (!isImageAvailable) {
      await this.pullMilvusImage(dockerode, logger);
    }

    const port = getRandomPort();
    // Create and start the container using podman CLI
    logger?.log('Creating and starting container...');
    const createContainerOptions: Dockerode.ContainerCreateOptions = {
      name: containerName,
      Image: MILVUS_IMAGE,
      Cmd: ['milvus', 'run', 'standalone'],
      Env: [
        'ETCD_USE_EMBED=true',
        'ETCD_DATA_DIR=/var/lib/milvus/etcd',
        'ETCD_CONFIG_PATH=/milvus/configs/embedEtcd.yaml',
        'COMMON_STORAGETYPE=local',
        'DEPLOY_MODE=STANDALONE',
      ],
      HostConfig: {
        PortBindings: {
          [`${MILVUS_PORT}/tcp`]: [{ HostPort: `${port}` }],
        },
        Binds: [
          `${storagePath}:/var/lib/milvus:Z`,
          `${etcdConfigFile}:/milvus/configs/embedEtcd.yaml:Z`,
          `${userConfigFile}:/milvus/configs/user.yaml:Z`,
        ],
      },
      Labels: { 'ai.openkaiden.milvus.name': safeName, 'ai.openkaiden.milvus.port': port.toString() },
    };
    const container = await dockerode.createContainer(createContainerOptions);
    await container.start();
    logger?.log(`Container created and started with ID: ${container.id}`);
    this.registerConnection({ path: containerConnection.path, id: container.id, name: safeName, port, running: true });

    logger?.log(`Milvus RAG connection '${name}' created successfully`);
  }
}
