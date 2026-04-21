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
import { openAsBlob } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import * as api from '@openkaiden/api';
import { Uri } from '@openkaiden/api';
import type { ContainerExtensionAPI } from '@openkaiden/container-extension-api';
// eslint-disable-next-line import/no-extraneous-dependencies
import type Dockerode from 'dockerode';

const DOCLING_IMAGE = `quay.io/docling-project/docling-serve:v1.9.0`;
const DOCLING_PORT = 5001;
const CONTAINER_NAME = 'docling-chunker';

type DoclingContainerInfo = {
  dockerode: Dockerode;
  containerId: string;
  port: number;
};

export class DoclingExtension {
  private containerInfo: DoclingContainerInfo | undefined = undefined;
  private processedDocuments: number = 0;

  constructor(private extensionContext: api.ExtensionContext) {}

  /**
   * Get a random port for the container
   */
  private getRandomPort(): number {
    return randomInt(1024, 65536);
  }

  async discoverExistingContainer(
    containerExtensionAPI: ContainerExtensionAPI,
  ): Promise<DoclingContainerInfo | undefined> {
    console.log('Discovering existing Docling container...');

    try {
      for (const endpoint of containerExtensionAPI.getEndpoints()) {
        try {
          const containers = await endpoint.dockerode.listContainers({ all: true });
          for (const container of containers) {
            const doclingPort = container.Labels?.['ai.openkaiden.docling.port'];

            if (doclingPort !== undefined) {
              console.log(`Found container: (with port ${doclingPort}, state: ${container.State})`);
              if (container.State !== 'running') {
                console.log('Container is not running, restarting...');
                await endpoint.dockerode.getContainer(container.Id).start();
              }
              return {
                dockerode: endpoint.dockerode,
                containerId: container.Id,
                port: parseInt(doclingPort, 10),
              };
            }
          }
        } catch (err: unknown) {
          console.error(`Error while listing containers on endpoint ${endpoint}:`, err);
        }
      }
    } catch (err: unknown) {
      console.error('Failed to get endpoints:', err);
      return undefined;
    }
  }

  async launchContainer(containerExtensionAPI: ContainerExtensionAPI): Promise<DoclingContainerInfo> {
    console.log('Launching Docling container...');

    const dockerode = containerExtensionAPI.getEndpoints()[0]?.dockerode;
    if (dockerode === undefined) {
      throw new Error('No container engine endpoint found');
    }

    // Get a random port for the container
    const containerPort = this.getRandomPort();

    // Start the container
    const isImageAvailable = await this.checkDoclingImage(dockerode);
    if (!isImageAvailable) {
      await this.pullDoclingImage(dockerode);
    }
    console.log(`Starting Docling container with image ${DOCLING_IMAGE} on port ${containerPort}`);
    const container = await dockerode.createContainer({
      name: CONTAINER_NAME,
      Labels: {
        'ai.openkaiden.docling.port': `${containerPort}`,
      },
      Image: DOCLING_IMAGE,
      HostConfig: {
        AutoRemove: true,
        PortBindings: {
          [`${DOCLING_PORT}/tcp`]: [{ HostPort: `${containerPort}` }],
        },
      },
    });
    await container.start();
    console.log(`Container started with ID: ${container.id}`);

    // Wait for the service to be healthy
    let started = false;
    let retries = 0;
    while (!started && retries++ < 20) {
      try {
        const response = await fetch(`http://localhost:${containerPort}/health`);
        if (response.ok) {
          console.log('Docling service is healthy');
          started = true;
          return {
            dockerode,
            containerId: container.id,
            port: containerPort,
          };
        } else {
          console.warn('Docling service health check returned non-OK status');
        }
      } catch (err) {
        console.warn(`Health check failed: ${err}`);
      } finally {
        if (!started) {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    throw new Error('Failed to start Docling container');
  }

  /**
   * Initialize the Docling chunker by starting the container
   */
  async activate(): Promise<void> {
    console.log('Starting Docling container...');

    const workspaceFolder = join(this.extensionContext.storagePath, 'docling-workspace');
    await mkdir(workspaceFolder, { recursive: true });

    const KAIDEN_CONTAINER_EXTENSION_ID = 'kaiden.container';
    const containerExtension = api.extensions.getExtension<ContainerExtensionAPI>(KAIDEN_CONTAINER_EXTENSION_ID);
    if (!containerExtension) {
      throw new Error(`Mandatory extension ${KAIDEN_CONTAINER_EXTENSION_ID} is not installed`);
    }
    const containerExtensionAPI = containerExtension?.exports;
    if (!containerExtensionAPI) {
      throw new Error(`Missing exports of API in container extension ${KAIDEN_CONTAINER_EXTENSION_ID}`);
    }

    const existingContainer = await this.discoverExistingContainer(containerExtensionAPI);

    if (existingContainer) {
      this.containerInfo = existingContainer;
    } else {
      try {
        this.containerInfo = await this.launchContainer(containerExtensionAPI);
      } catch (err: unknown) {
        console.error('Failed to start container:', err);
        throw err;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    // Create the Docling chunk provider
    const doclingChunkProvider: api.ChunkProvider = {
      name: 'docling',
      async chunk(doc: api.Uri): Promise<api.Chunk[]> {
        try {
          return await self.convertDocument(doc);
        } catch (err) {
          console.error('Failed to convert document:', err);
          throw err;
        }
      },
    };

    // Register the chunk provider
    const disposable = api.rag.registerChunkProvider(doclingChunkProvider);

    // Add to subscriptions for proper cleanup
    this.extensionContext.subscriptions.push(disposable);
  }

  /**
   * Shutdown the Docling chunker by stopping and removing the container
   */
  async deactivate(): Promise<void> {
    if (!this.containerInfo) {
      return;
    }

    console.log('Stopping Docling container...');

    try {
      // Stop the container
      console.log('Container removed');
      await this.containerInfo.dockerode.getContainer(this.containerInfo.containerId).stop();
    } catch (err: unknown) {
      console.error('Failed to stop container:', err);
    }

    try {
      await rm(join(this.extensionContext.storagePath, 'docling-workspace'), { recursive: true, force: true });
    } catch (err: unknown) {
      console.error('Failed to remove workspace folder:', err);
    }

    this.containerInfo = undefined;
  }

  /**
   * Convert a document to chunks using the Docling service
   */
  async convertDocument(docUri: api.Uri): Promise<api.Chunk[]> {
    if (!this.containerInfo) {
      throw new Error('Docling container is not running');
    }

    // Copy the document to the folder
    const docPath = docUri.fsPath;
    const docFileName = basename(docPath);

    const data = new FormData();
    const blob = await openAsBlob(docPath);
    data.set('files', blob, docFileName);
    // Send conversion request to the service
    const response = await fetch(`http://localhost:${this.containerInfo.port}/v1/chunk/hierarchical/file`, {
      method: 'POST',
      body: data,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Conversion failed: ${response.status} ${error}`);
    }

    const res = await response.json();
    console.log(res);

    // Read the chunk files
    const chunks: api.Chunk[] = [];
    const documentNumber = this.processedDocuments++;
    if (typeof res === 'object' && res && 'chunks' in res && Array.isArray(res.chunks)) {
      for (let i = 0; i < res.chunks.length; i++) {
        const chunkPath = join(
          this.extensionContext.storagePath,
          'docling-workspace',
          `doc${documentNumber}-chunk${i}.txt`,
        );
        await writeFile(chunkPath, res.chunks[i].text, 'utf-8');
        chunks.push({
          text: Uri.file(chunkPath),
        });
      }
    }

    return chunks;
  }

  private async checkDoclingImage(dockerode: Dockerode): Promise<boolean> {
    console.log(`Checking if Docling image ${DOCLING_IMAGE} is available...`);
    try {
      await dockerode.getImage(DOCLING_IMAGE).inspect();
      return true;
    } catch (err: unknown) {
      return false;
    }
  }

  private async pullDoclingImage(dockerode: Dockerode): Promise<void> {
    console.log(`Pulling Docling image ${DOCLING_IMAGE}...`);
    const promise = Promise.withResolvers<void>();
    try {
      const stream = await dockerode.pull(DOCLING_IMAGE);
      const onFinished = (err: Error | null): void => {
        if (err) {
          promise.reject(err);
          return;
        }
        promise.resolve();
      };
      dockerode.modem.followProgress(stream, onFinished);
    } catch (err: unknown) {
      throw new Error(`Failed to pull Docling image ${DOCLING_IMAGE}: ${err}`);
    }
    return promise.promise;
  }
}
