/**********************************************************************
 * Copyright (C) 2022-2025 Red Hat, Inc.
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

import { experimental_createMCPClient } from '@ai-sdk/mcp';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolSet } from 'ai';
import { inject, injectable, preDestroy } from 'inversify';

import { MCPExchanges, MCPMessageExchange } from '/@/plugin/mcp/mcp-exchanges.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import { IAsyncDisposable } from '/@api/async-disposable.js';
import type { MCPCommandSpec, MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info.js';

/**
 * experimental_createMCPClient return `Promise<MCPClient>` but they did not exported this type...
 */
type ExtractedMCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

@injectable()
export class MCPManager implements IAsyncDisposable {
  #client: Map<string, ExtractedMCPClient> = new Map<string, ExtractedMCPClient>();

  #mcps: MCPRemoteServerInfo[] = [];

  constructor(
    @inject(ApiSenderType) private apiSender: ApiSenderType,
    @inject(MCPExchanges) private exchanges: MCPExchanges,
  ) {}

  /**
   * Cleanup all clients
   */
  @preDestroy()
  async asyncDispose(): Promise<void> {
    await Promise.all(Array.from(this.#client.values().map(({ close }) => close())));
  }

  protected getKey(
    internalProviderId: string,
    serverId: string,
    setupType: 'remote' | 'package',
    index: number,
  ): string {
    return `${internalProviderId}:${serverId}:${setupType}:${index}`;
  }

  public get(key: string): MCPRemoteServerInfo {
    const server = this.#mcps.find(({ id }) => id === key);
    if (!server) throw new Error(`cannot find MCP server with id ${key}`);
    return server;
  }

  public decomposeKey(raw: string): {
    internalProviderId: string;
    serverId: string;
    remoteId: number;
    connectionName: string;
  } {
    const [internalProviderId, serverId, remoteId, connectionName] = raw.split(':');
    if (!internalProviderId || !serverId || !remoteId || !connectionName) throw new Error('invalid key');
    return {
      internalProviderId,
      serverId,
      remoteId: Number.parseInt(remoteId),
      connectionName,
    };
  }

  /**
   * Returns the list of recorded exchanges for a given client key.
   */
  public getExchanges(key: string): MCPMessageExchange[] {
    return this.exchanges.getExchanges(key);
  }

  /**
   * @param selected
   */
  public async getToolSet(selected: Record<string, Array<string>> | undefined = undefined): Promise<ToolSet> {
    let tools: Array<ToolSet>;
    if (!selected) {
      // Get all tools without filtering
      tools = await Promise.all(this.#client.values().map(client => client.tools()));
    } else {
      tools = await Promise.all(
        Object.entries(selected).map(
          async ([mcpId, tools]) => {
            const client = this.#client.get(mcpId);
            if (!client) {
              return {};
            }
            const toolset = await client.tools();

            const filteredSet = new Set<string>(tools);

            return Object.entries(toolset).reduce((accumulator, [toolName, content]) => {
              if (filteredSet.has(toolName)) {
                accumulator[toolName] = content;
              }

              return accumulator;
            }, {} as ToolSet);
          },
          [] as Array<ToolSet>,
        ),
      );
    }

    return tools.reduce((acc, current) => {
      return { ...acc, ...current };
    }, {});
  }

  public async registerMCPClient(
    internalProviderId: string,
    serverId: string,
    setupType: 'remote' | 'package',
    index: number,
    connectionName: string,
    transport: Transport,
    url?: string,
    description?: string,
    isValidSchema?: boolean,
    commandSpec?: MCPCommandSpec,
  ): Promise<void> {
    const key = this.getKey(internalProviderId, serverId, setupType, index);

    const wrapped = this.exchanges.createMiddleware(key, transport);

    const client = await experimental_createMCPClient({ transport: wrapped });

    console.log('[MCPManager] Registering MCP client for ', internalProviderId, ' with name ', connectionName);
    this.#client.set(key, client);

    const toolSet = await client.tools();
    const tools = Object.fromEntries(
      Object.entries(toolSet).map(([key, value]) => [
        key,
        {
          description: value.description ?? '',
        },
      ]),
    );

    const mcpRemoteServerInfo: MCPRemoteServerInfo = {
      id: key,
      infos: { internalProviderId, remoteId: index, serverId },
      name: connectionName,
      url: url ?? '',
      setupType,
      commandSpec,
      description: description ?? '',
      tools,
      isValidSchema,
    };
    this.#mcps.push(mcpRemoteServerInfo);

    // broadcast new items
    this.apiSender.send('mcp-manager-update');
  }

  public async unregisterMCPClient(
    internalProviderId: string,
    serverId: string,
    setupType: 'remote' | 'package',
    index: number,
  ): Promise<void> {
    const key = this.getKey(internalProviderId, serverId, setupType, index);
    return this.removeMcpRemoteServer(key);
  }

  init(): void {}

  public async listMCPRemoteServers(): Promise<MCPRemoteServerInfo[]> {
    return this.#mcps;
  }

  public async removeMcpRemoteServer(key: string): Promise<void> {
    const instance = this.#client.get(key);
    if (!instance) throw new Error(`cannot find MCP instance with key ${key}`);

    // Close the client connection
    await instance.close();

    // remove the instance
    this.#client.delete(key);
    this.exchanges.clearExchanges(key);

    // clear from the #mcps list
    this.#mcps = this.#mcps.filter(mcp => mcp.id !== key);

    // broadcast new items
    this.apiSender.send('mcp-manager-update');
  }

  findMcpRemoteServer(
    INTERNAL_PROVIDER_ID: string,
    serverId: string,
    type: 'remote' | 'package',
    index: number,
  ): MCPRemoteServerInfo | undefined {
    const key = this.getKey(INTERNAL_PROVIDER_ID, serverId, type, index);
    return this.#mcps.find(mcp => mcp.id === key);
  }
}
