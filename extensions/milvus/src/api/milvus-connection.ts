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

import { readFile } from 'node:fs/promises';

import type { MCPServerDetail, ProviderConnectionLifecycle, ProviderConnectionStatus } from '@openkaiden/api';
import * as api from '@openkaiden/api';
import { DataType, FunctionType, MilvusClient } from '@zilliz/milvus2-sdk-node';

export class MilvusConnection implements api.RagProviderConnection {
  private connectionStatus: api.ProviderConnectionStatus;
  mcpServer: api.MCPServer;
  lifecycle: ProviderConnectionLifecycle | undefined;

  constructor(
    public path: string,
    public name: string,
    public containerId: string,
    private port: number,
    running: boolean,
  ) {
    this.connectionStatus = running ? 'started' : 'stopped';
    const server: MCPServerDetail = {
      name: `kaiden.milvus.mcp-server-milvus-${name}`,
      version: '0.1.1.dev8',
      description: 'Milvus MCP Server for Knowledge Databases',
      packages: [
        {
          registryType: 'pypi',
          identifier: 'mcp-server-milvus',
          version: '0.1.1.dev8',
          runtimeHint: 'python',
          packageArguments: [
            {
              isRequired: true,
              format: 'string',
              value: '--milvus-uri',
              isSecret: false,
            },
            {
              isRequired: true,
              format: 'string',
              value: `http://localhost:${port}`,
              isSecret: false,
            },
          ],
        },
      ],
    };

    const registeredServer = api.mcpRegistry.registerServer(server);
    this.mcpServer = {
      serverId: registeredServer.serverId,
      config: {
        type: 'package',
        index: 0,
        runtimeArguments: {},
        packageArguments: {},
        environmentVariables: {},
      },
    };
  }

  status(): api.ProviderConnectionStatus {
    return this.connectionStatus;
  }

  async start(_startContext: api.LifecycleContext): Promise<void> {
    this.connectionStatus = 'started';
  }

  async stop(_stopContext: api.LifecycleContext): Promise<void> {
    this.connectionStatus = 'stopped';
  }

  private getMilvusClient(): MilvusClient {
    return new MilvusClient({
      address: `localhost:${this.port}`,
    });
  }

  private async ensureCollection(client: MilvusClient, collectionName: string): Promise<void> {
    // Check if collection exists
    const hasCollection = await client.hasCollection({ collection_name: collectionName });

    if (!hasCollection.value) {
      // Create collection with schema for document chunks
      const schema = [
        {
          name: 'id',
          data_type: DataType.Int64,
          is_primary_key: true,
          autoID: true,
        },
        {
          name: 'doc_uri',
          data_type: DataType.VarChar,
          max_length: 1024,
        },
        {
          name: 'text',
          data_type: DataType.VarChar,
          max_length: 65535,
          enable_analyzer: true,
          enable_match: true,
        },
        {
          name: 'sparse',
          data_type: DataType.SparseFloatVector,
        },
      ];

      const index_params = [
        {
          field_name: 'sparse',
          metric_type: 'BM25',
          index_type: 'SPARSE_INVERTED_INDEX',
          params: {
            inverted_index_algo: 'DAAT_MAXSCORE',
            bm25_k1: 1.2,
            bm25_b: 0.75,
          },
        },
      ];

      const functions = [
        {
          name: 'text_bm25_emb',
          description: 'bm25 function',
          type: FunctionType.BM25,
          input_field_names: ['text'],
          output_field_names: ['sparse'],
          params: {},
        },
      ];

      await client.createCollection({
        collection_name: collectionName,
        schema,
        index_params,
        functions,
      });

      // Create index on the embedding field
      await client.createIndex({
        collection_name: collectionName,
        field_name: 'embedding',
        index_type: 'IVF_FLAT',
        metric_type: 'L2',
        params: { nlist: 128 },
      });

      // Load collection into memory
      await client.loadCollection({ collection_name: collectionName });
    }
  }

  public async index(doc: api.Uri, chunks: api.Uri[]): Promise<void> {
    const client = this.getMilvusClient();
    const collectionName = this.name;

    try {
      // Ensure collection exists
      await this.ensureCollection(client, collectionName);

      // Prepare data for insertion
      const data = [];

      for (const chunk of chunks) {
        const chunkText = await readFile(chunk.fsPath, 'utf-8');

        data.push({
          doc_uri: doc.toString(),
          text: chunkText,
        });
      }

      // Insert data into Milvus
      if (data.length > 0) {
        await client.insert({
          collection_name: collectionName,
          data,
        });

        // Flush to ensure data is persisted
        await client.flush({ collection_names: [collectionName] });
      }
    } catch (err: unknown) {
      console.error('Error indexing document:', err);
      throw err;
    }
  }

  async deindex(doc: api.Uri): Promise<void> {
    const client = this.getMilvusClient();
    const collectionName = this.name;

    try {
      // Check if collection exists
      const hasCollection = await client.hasCollection({ collection_name: collectionName });

      if (hasCollection.value) {
        // Delete all chunks for this document
        const escapedUri = doc.toString().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await client.delete({
          collection_name: collectionName,
          filter: `doc_uri == "${escapedUri}"`,
        });

        // Flush to ensure deletion is persisted
        await client.flush({ collection_names: [collectionName] });
      }
    } finally {
      // Client cleanup is handled automatically
    }
  }

  updateStatus(status: ProviderConnectionStatus): void {
    this.connectionStatus = status;
  }
}
