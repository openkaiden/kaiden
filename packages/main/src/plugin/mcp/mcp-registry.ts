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

import * as crypto from 'node:crypto';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type * as kaidenAPI from '@openkaiden/api';
import { SecretStorage } from '@openkaiden/api';
import type { components } from '@openkaiden/mcp-registry-types';
import type { HttpsOptions, OptionsOfTextResponseBody } from 'got';
import { HttpProxyAgent, HttpsProxyAgent } from 'hpagent';
import { inject, injectable } from 'inversify';

import { MCPPackage } from '/@/plugin/mcp/package/mcp-package.js';
import { formatArguments } from '/@/plugin/mcp/utils/arguments.js';
import { formatKeyValueInputs } from '/@/plugin/mcp/utils/format-key-value-inputs.js';
import { ProviderRegistry } from '/@/plugin/provider-registry.js';
import { SafeStorageRegistry } from '/@/plugin/safe-storage/safe-storage-registry.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import { IConfigurationNode, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { ValidatedServerDetail, ValidatedServerList, ValidatedServerResponse } from '/@api/mcp/mcp-server-info.js';
import { MCPServerDetail } from '/@api/mcp/mcp-server-info.js';
import { InputWithVariableResponse, MCPSetupOptions } from '/@api/mcp/mcp-setup.js';

import { Certificates } from '../certificates.js';
import { Emitter } from '../events/emitter.js';
import { Proxy } from '../proxy.js';
import { Telemetry } from '../telemetry/telemetry.js';
import { Disposable } from '../types/disposable.js';
import { MCPManager } from './mcp-manager.js';
import { MCPSchemaValidator } from './mcp-schema-validator.js';

/**
 * Returns an absolute registry base URL for HTTP requests. Host-only input (e.g.
 * `registry.modelcontextprotocol.io`) is prefixed with `https://` so `new URL()` and `fetch` work.
 */
export function normalizeMcpRegistryServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  let result = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(result)) {
    result = `https://${result}`;
  }
  // Strip trailing slashes so `/v0/servers` is appended cleanly.
  // Uses a loop instead of regex to avoid sonarjs/slow-regex on `/\/+$/`.
  let end = result.length;
  while (end > 0 && result.charCodeAt(end - 1) === 47 /* / */) {
    end--;
  }
  return end < result.length ? result.slice(0, end) : result;
}

interface RemoteStorageConfigFormat {
  serverId: string;
  remoteId: number;
  headers: { [key: string]: string };
}

interface PackageStorageConfigFormat {
  serverId: string;
  packageId: number;
  runtimeArguments?: Array<string>;
  packageArguments?: Array<string>;
  environmentVariables?: Record<string, string>;
}

type StorageConfigFormat = RemoteStorageConfigFormat | PackageStorageConfigFormat;

type InternalMCPRegistry = kaidenAPI.MCPRegistry & { save: boolean };

const STORAGE_KEY = 'mcp:registry:configurations';
export const INTERNAL_PROVIDER_ID = 'internal';

const MCP_SECTION_NAME = 'mcp';
const MCP_REGISTRIES = 'registries';

interface MCPRegistryEntry {
  lastAccess: Date;
  servers: ValidatedServerList;
}

// Definition of all MCP registries (MCP registry is an URL serving MCP providers it implements the MCP registry protocol)
@injectable()
export class MCPRegistry {
  private registries: InternalMCPRegistry[] = [];
  private suggestedRegistries: kaidenAPI.RegistrySuggestedProvider[] = [];
  private providers: Map<string, kaidenAPI.MCPRegistryProvider> = new Map();
  private internalMCPServers: MCPServerDetail[] = [];
  #remoteMCPServers: Map<string, MCPRegistryEntry> = new Map();

  private readonly _onDidRegisterRegistry = new Emitter<kaidenAPI.MCPRegistry>();
  private readonly _onDidUpdateRegistry = new Emitter<kaidenAPI.MCPRegistry>();
  private readonly _onDidUnregisterRegistry = new Emitter<kaidenAPI.MCPRegistry>();

  readonly onDidRegisterRegistry: kaidenAPI.Event<kaidenAPI.MCPRegistry> = this._onDidRegisterRegistry.event;
  readonly onDidUpdateRegistry: kaidenAPI.Event<kaidenAPI.MCPRegistry> = this._onDidUpdateRegistry.event;
  readonly onDidUnregisterRegistry: kaidenAPI.Event<kaidenAPI.MCPRegistry> = this._onDidUnregisterRegistry.event;

  private proxySettings: kaidenAPI.ProxySettings | undefined;
  private proxyEnabled: boolean;

  private safeStorage: SecretStorage | undefined = undefined;

  private configuration: kaidenAPI.Configuration;

  constructor(
    @inject(ApiSenderType)
    private apiSender: ApiSenderType,
    @inject(Telemetry)
    private telemetryService: Telemetry,
    @inject(Certificates)
    private certificates: Certificates,
    @inject(Proxy)
    private proxy: Proxy,
    @inject(MCPManager)
    private mcpManager: MCPManager,
    @inject(SafeStorageRegistry)
    private safeStorageRegistry: SafeStorageRegistry,
    @inject(IConfigurationRegistry)
    private configurationRegistry: IConfigurationRegistry,
    @inject(MCPSchemaValidator)
    private schemaValidator: MCPSchemaValidator,
    @inject(ProviderRegistry)
    private providerRegistry: ProviderRegistry,
  ) {
    this.proxy.onDidUpdateProxy(settings => {
      this.proxySettings = settings;
    });

    this.proxy.onDidStateChange(state => {
      this.proxyEnabled = state;
    });

    this.proxyEnabled = this.proxy.isEnabled();
    if (this.proxyEnabled) {
      this.proxySettings = this.proxy.proxy;
    }

    this.providerRegistry.onDidRegisterRagConnection(e => {
      if (e.connection.status() === 'started') {
        this.setupMCPServer(e.connection.mcpServer.serverId, e.connection.mcpServer.config).catch(console.error);
      }
    });

    this.providerRegistry.onDidUpdateRagConnection(e => {
      if (e.status === 'started') {
        this.setupMCPServer(e.connection.mcpServer.serverId, e.connection.mcpServer.config).catch(console.error);
      } else if (e.status === 'stopped') {
        this.resetMCPServer(
          e.connection.mcpServer.serverId,
          e.connection.mcpServer.config.type,
          e.connection.mcpServer.config.index,
        ).catch(console.error);
      }
    });

    const mcpRegistriesConfiguration: IConfigurationNode = {
      id: 'preferences.mcp',
      title: 'MCP',
      type: 'object',
      properties: {
        [`${MCP_SECTION_NAME}.${MCP_REGISTRIES}`]: {
          description: 'MCP registries',
          type: 'array',
          hidden: true,
        },
      },
    };
    this.configurationRegistry.registerConfigurations([mcpRegistriesConfiguration]);

    this.configuration = this.configurationRegistry.getConfiguration(MCP_SECTION_NAME);
  }

  enhanceServerDetail(server: ValidatedServerDetail): MCPServerDetail {
    return { ...server, serverId: encodeURI(server.name) };
  }

  init(): void {
    console.log('[MCPRegistry] init');
    this.safeStorage = this.safeStorageRegistry.getCoreStorage();
    this.loadRegistriesFromConfig();

    this.onDidRegisterRegistry(async registry => {
      const configurations = await this.getConfigurations();
      console.log(`[MCPRegistry] found ${configurations.length} saved configurations`);

      // serverId => config
      const mapping: Map<string, StorageConfigFormat> = new Map(
        configurations.map(config => [config.serverId, config]),
      );

      const { servers } = await this.listMCPServersFromRegistry(registry.serverUrl);
      for (const rawServer of servers) {
        const server = this.enhanceServerDetail(rawServer.server);
        if (!server.serverId) {
          continue;
        }
        const config = mapping.get(server.serverId);
        if (!config) {
          continue;
        }

        // dealing with remote config
        if ('remoteId' in config) {
          const remote = server.remotes?.[config.remoteId];
          if (!remote) {
            continue;
          }

          // client already exists ?
          const existingServers = await this.mcpManager.listMCPRemoteServers();
          const existing = existingServers.find(srv => srv.id.includes(server.serverId ?? 'unknown'));
          if (existing) {
            console.log(`[MCPRegistry] MCP client for server ${server.serverId} already exists, skipping`);
            continue;
          }

          // create transport
          const transport = new StreamableHTTPClientTransport(new URL(remote.url), {
            requestInit: {
              headers: config.headers,
            },
          });

          await this.mcpManager.registerMCPClient(
            INTERNAL_PROVIDER_ID,
            server.serverId,
            'remote',
            config.remoteId,
            server.name,
            transport,
            remote.url,
            server.description,
            server.isValidSchema,
          );
        } else {
          const pack = server.packages?.[config.packageId];
          if (!pack) {
            continue;
          }

          // client already exists ?
          const existingServers = await this.mcpManager.listMCPRemoteServers();
          const existing = existingServers.find(srv => srv.id.includes(server.serverId ?? 'unknown'));
          if (existing) {
            console.log(`[MCPRegistry] MCP client for server ${server.serverId} already exists, skipping`);
            continue;
          }
          const spawner = new MCPPackage({
            ...pack,
            packageArguments: config.packageArguments,
            runtimeArguments: config.runtimeArguments,
            environmentVariables: config.environmentVariables,
          });

          const transport = await spawner.spawn();
          await this.mcpManager.registerMCPClient(
            INTERNAL_PROVIDER_ID,
            server.serverId,
            'package',
            config.packageId,
            server.name,
            transport,
            undefined,
            server.description,
            server.isValidSchema,
            spawner.buildCommandSpec(),
          );
        }
      }
    });
  }

  getRegistryHash(registry: { serverUrl: string }): string {
    return crypto.createHash('sha512').update(registry.serverUrl).digest('hex');
  }

  registerMCPRegistry(registry: kaidenAPI.MCPRegistry, save: boolean): Disposable {
    const normalized: kaidenAPI.MCPRegistry = {
      ...registry,
      serverUrl: normalizeMcpRegistryServerUrl(registry.serverUrl),
    };
    return this.registerMCPRegistryNormalized(normalized, save);
  }

  /**
   * Registers using an already-normalized `serverUrl` (e.g. after {@link createRegistry} normalized once).
   * Public {@link registerMCPRegistry} normalizes then delegates here.
   */
  private registerMCPRegistryNormalized(registry: kaidenAPI.MCPRegistry, save: boolean): Disposable {
    console.log(`[MCPRegistry] registerMCPRegistry ${registry.serverUrl}`);
    const found = this.registries.find(reg => reg.serverUrl === registry.serverUrl);
    if (found) {
      // Ignore and don't register - extension may register registries every time it is restarted
      console.log('Registry already registered, skipping registration');
      return Disposable.noop();
    }
    this.registries = [...this.registries, { ...registry, save }];
    if (save) {
      this.saveRegistriesToConfig();
    }
    this.telemetryService.track('registerRegistry', {
      serverUrl: this.getRegistryHash(registry),
      total: this.registries.length,
    });
    this.apiSender.send('mcp-registry-register', registry);
    this._onDidRegisterRegistry.fire(Object.freeze({ ...registry }));
    return Disposable.create(() => {
      this.unregisterMCPRegistry(registry, save);
    });
  }

  suggestMCPRegistry(registry: kaidenAPI.MCPRegistrySuggestedProvider): Disposable {
    const normalized: kaidenAPI.MCPRegistrySuggestedProvider = {
      ...registry,
      url: normalizeMcpRegistryServerUrl(registry.url),
    };
    // Do not add it to the list if it's already been suggested by name & URL
    // this may have been done by another extension.
    if (this.suggestedRegistries.find(reg => reg.url === normalized.url && reg.name === normalized.name)) {
      // Ignore and don't register
      console.log(`Registry already registered: ${normalized.url}`);
      return Disposable.noop();
    }

    this.suggestedRegistries.push(normalized);
    this.apiSender.send('mcp-registry-update', normalized);

    this._onDidRegisterRegistry.fire({
      name: normalized.name,
      serverUrl: normalized.url,
      icon: normalized.icon,
      alias: undefined,
    });

    // Create a disposable to remove the registry from the list
    return Disposable.create(() => {
      this.unsuggestMCPRegistry(normalized);
    });
  }

  unsuggestMCPRegistry(registry: kaidenAPI.MCPRegistrySuggestedProvider): void {
    const normalized: kaidenAPI.MCPRegistrySuggestedProvider = {
      ...registry,
      url: normalizeMcpRegistryServerUrl(registry.url),
    };
    // Find the registry within this.suggestedRegistries[] and remove it
    const index = this.suggestedRegistries.findIndex(reg => reg.url === normalized.url && reg.name === normalized.name);
    if (index > -1) {
      this.suggestedRegistries.splice(index, 1);
    }

    // Fire an update to the UI to remove the suggested registry
    this.apiSender.send('mcp-registry-update', normalized);
  }

  unregisterMCPRegistry(registry: kaidenAPI.MCPRegistry, save: boolean): void {
    const normalized: kaidenAPI.MCPRegistry = {
      ...registry,
      serverUrl: normalizeMcpRegistryServerUrl(registry.serverUrl),
    };
    const filtered = this.registries.filter(registryItem => registryItem.serverUrl !== normalized.serverUrl);
    if (filtered.length !== this.registries.length) {
      this._onDidUnregisterRegistry.fire(Object.freeze({ ...normalized }));
      this.registries = filtered;
      if (save) {
        this.saveRegistriesToConfig();
      }
      this.apiSender.send('mcp-registry-unregister', normalized);
    }
    this.telemetryService.track('unregisterMCPRegistry', {
      serverUrl: this.getRegistryHash(normalized),
      total: this.registries.length,
    });
  }

  getRegistries(): readonly kaidenAPI.MCPRegistry[] {
    return this.registries;
  }

  getSuggestedRegistries(): kaidenAPI.MCPRegistrySuggestedProvider[] {
    return this.suggestedRegistries;
  }

  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  registerMCPRegistryProvider(registerRegistryProvider: kaidenAPI.MCPRegistryProvider): Disposable {
    this.providers.set(registerRegistryProvider.name, registerRegistryProvider);
    return Disposable.create(() => {
      this.providers.delete(registerRegistryProvider.name);
    });
  }

  async createRegistry(registryCreateOptions: kaidenAPI.MCPRegistryCreateOptions): Promise<Disposable> {
    let telemetryOptions = {};
    const normalized: kaidenAPI.MCPRegistryCreateOptions = {
      ...registryCreateOptions,
      serverUrl: normalizeMcpRegistryServerUrl(registryCreateOptions.serverUrl),
    };
    try {
      const exists = this.registries.find(registry => registry.serverUrl === normalized.serverUrl);
      if (exists) {
        throw new Error(`Registry ${normalized.serverUrl} already exists`);
      }

      // `MCPRegistry` extends `MCPRegistryCreateOptions` with only optional fields (`name`, `icon`);
      // create flow only supplies create-options, which is structurally valid for registration.
      return this.registerMCPRegistryNormalized(normalized, true);
    } catch (error) {
      telemetryOptions = { error: error };
      throw error;
    } finally {
      this.telemetryService.track('createMCPRegistry', {
        serverUrlHash: this.getRegistryHash(normalized),
        total: this.registries.length,
        ...telemetryOptions,
      });
    }
  }

  async setupMCPServer(serverId: string, options: MCPSetupOptions): Promise<void> {
    // Get back the server
    const serverDetails = await this.listMCPServersFromRegistries();
    const serverDetail = serverDetails.find(server => server.serverId === serverId);
    if (!serverDetail) {
      throw new Error(`MCP server with id ${serverId} not found in remote registry`);
    }

    let transport: Transport;
    let commandSpec: { command: string; args: string[]; env?: Record<string, string> } | undefined;
    let config: StorageConfigFormat;

    let url: string | undefined;

    switch (options.type) {
      case 'remote': {
        config = {
          remoteId: options.index,
          serverId: serverDetail.serverId,
          headers: Object.fromEntries(
            Object.entries(options.headers).map(([key, response]) => [
              key,
              this.formatInputWithVariableResponse(response),
            ]),
          ),
        };
        const remote = serverDetail.remotes?.[options.index];
        transport = this.setupRemote(remote, config.headers);
        url = remote?.url;
        break;
      }
      case 'package': {
        const pack = serverDetail.packages?.[options.index];
        if (!pack) throw new Error('package not found');

        config = {
          packageId: options.index,
          serverId: serverDetail.serverId,
          runtimeArguments: formatArguments(
            pack.runtimeArguments,
            Object.fromEntries(
              Object.entries(options.runtimeArguments).map(([key, response]) => [
                key,
                this.formatInputWithVariableResponse(response),
              ]),
            ),
          ),
          // if the user provided package arguments, we want to override it
          packageArguments: formatArguments(
            pack.packageArguments,
            Object.fromEntries(
              Object.entries(options.packageArguments).map(([key, response]) => [
                key,
                this.formatInputWithVariableResponse(response),
              ]),
            ),
          ),
          // if the user provided environment variables, we want to override it
          environmentVariables: formatKeyValueInputs(
            pack.environmentVariables,
            Object.fromEntries(
              Object.entries(options.environmentVariables).map(([key, response]) => [
                key,
                this.formatInputWithVariableResponse(response),
              ]),
            ),
          ),
        };
        const spawner = new MCPPackage({
          ...pack,
          packageArguments: config.packageArguments,
          runtimeArguments: config.runtimeArguments,
          environmentVariables: config.environmentVariables,
        });
        transport = await spawner.spawn();
        commandSpec = spawner.buildCommandSpec();
        break;
      }
      default:
        throw new Error('invalid options type for setupMCPServer');
    }

    // get values from the server detail
    const { name, description, isValidSchema } = serverDetail;

    await this.mcpManager.registerMCPClient(
      INTERNAL_PROVIDER_ID,
      serverId,
      options.type,
      options.index,
      name,
      transport,
      url,
      description,
      isValidSchema,
      commandSpec,
    );

    // persist configuration
    await this.saveConfiguration(config);
  }

  async resetMCPServer(serverId: string, setupType: 'remote' | 'package', remoteId: number): Promise<void> {
    await this.deleteRemoteMcpFromConfiguration(serverId, remoteId);
    return this.mcpManager.unregisterMCPClient(INTERNAL_PROVIDER_ID, serverId, setupType, remoteId);
  }

  protected formatInputWithVariableResponse(input: InputWithVariableResponse): string {
    let template = input.value;

    Object.entries(input.variables).forEach(([key, response]) => {
      template = template.replace(`{${key}}`, response.value);
    });

    return template;
  }

  protected setupRemote(
    remote: components['schemas']['StreamableHttpTransport'] | components['schemas']['SseTransport'] | undefined,
    headers: Record<string, string>,
  ): Transport {
    if (!remote) throw new Error('remote not found');

    /**
     * HARDCODED BAD BAD BAD
     */
    if ('Bearer' in headers) {
      headers['Authorization'] = headers['Bearer'];
    }

    // create transport
    return new StreamableHTTPClientTransport(new URL(remote.url), {
      requestInit: {
        headers: headers,
      },
    });
  }

  public async getCredentials(
    serverId: string,
    remoteId: number,
  ): Promise<{
    headers: Record<string, string>;
  }> {
    const configs = await this.getConfigurations();

    const configuration = configs.find(
      (item): item is RemoteStorageConfigFormat =>
        'remoteId' in item && item.serverId === serverId && item.remoteId === remoteId,
    );
    if (!configuration) throw new Error(`Configuration not found for serverId ${serverId} and remoteId ${remoteId}`);

    return {
      headers: configuration.headers,
    };
  }

  async getConfigurations(): Promise<Array<StorageConfigFormat>> {
    const raw = await this.safeStorage?.get(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  }

  async saveConfiguration(config: StorageConfigFormat): Promise<void> {
    const existing = await this.getConfigurations();
    await this.safeStorage?.store(STORAGE_KEY, JSON.stringify([...existing, config]));
  }

  async deleteRemoteMcpFromConfiguration(serverId: string, remoteId: number): Promise<void> {
    const existingConfiguration = await this.getConfigurations();
    const filtered = existingConfiguration.filter(
      config => !('remoteId' in config && config.serverId === serverId && config.remoteId === remoteId),
    );
    await this.safeStorage?.store(STORAGE_KEY, JSON.stringify(filtered));
  }

  protected async listMCPServersFromRegistry(registryURL: string): Promise<ValidatedServerList> {
    const entry = this.#remoteMCPServers.get(registryURL);
    const servers = await this.fetchMCPServersFromRegistry(registryURL, entry);
    if (!entry) {
      this.#remoteMCPServers.set(registryURL, {
        lastAccess: new Date(),
        servers,
      });
      return servers;
    } else {
      entry.servers.servers = entry.servers.servers.map(item => {
        const match = servers.servers.find(server => server.server.name === item.server.name);
        return match ?? item;
      });
      //handle created items
      servers.servers.forEach(server => {
        const match = entry.servers.servers.find(item => item.server.name === server.server.name);
        if (!match) {
          entry.servers.servers.push(server);
        }
      });
      entry.lastAccess = new Date();
      return entry.servers;
    }
  }

  private async fetchMCPServersFromRegistry(
    registryURL: string,
    registryEntry?: MCPRegistryEntry,
    cursor?: string, // optional param for recursion
  ): Promise<ValidatedServerList> {
    const baseUrl = normalizeMcpRegistryServerUrl(registryURL);
    const url = new URL(`${baseUrl}/v0/servers`);
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }
    if (registryEntry) {
      url.searchParams.set('updated_since', registryEntry.lastAccess.toISOString());
    }
    // ask for latest versions
    url.searchParams.set('version', 'latest');

    const content = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!content.ok) {
      throw new Error(`Failed to fetch MCP servers from ${baseUrl}: ${content.statusText}`);
    }

    const data: components['schemas']['ServerList'] = await content.json();

    // Validate each server individually to catch all invalid servers
    const validatedServers: ValidatedServerResponse[] = data.servers.map(serverResponse => {
      const validationResult = this.schemaValidator.validateSchemaData(
        serverResponse,
        'ServerResponse',
        baseUrl,
        false,
      );
      return {
        ...serverResponse,
        server: {
          ...serverResponse.server,
          isValidSchema: validationResult,
        },
      };
    });

    // If pagination info exists, fetch the next page recursively
    if (data.metadata?.nextCursor) {
      const nextPage = await this.fetchMCPServersFromRegistry(baseUrl, registryEntry, data.metadata.nextCursor);
      return {
        ...data,
        servers: [...validatedServers, ...nextPage.servers],
        // merge metadata — keep the last page's metadata
        metadata: nextPage.metadata,
      };
    }

    return {
      ...data,
      servers: validatedServers,
    };
  }

  registerInternalMCPServer(server: MCPServerDetail): void {
    this.internalMCPServers.push(server);
  }

  unregisterInternalMCPServer(serverId: string): void {
    this.internalMCPServers = this.internalMCPServers.filter(srv => srv.serverId !== serverId);
  }

  getInternalMCPServer(serverId: string): MCPServerDetail | undefined {
    return this.internalMCPServers.find(srv => srv.serverId === serverId);
  }

  listInternalMCPServers(): MCPServerDetail[] {
    return this.internalMCPServers;
  }

  async listMCPServersFromRegistries(): Promise<Array<MCPServerDetail>> {
    // connect to each registry and grab server details
    const serverDetails: Array<MCPServerDetail> = [];

    // merge all urls to inspect
    const serverUrls: string[] = this.registries
      .map(registry => registry.serverUrl)
      .concat(this.suggestedRegistries.map(registry => registry.url));

    for (const registryURL of serverUrls) {
      try {
        const serverList = await this.listMCPServersFromRegistry(registryURL);
        // now, aggregate the servers from the list ensuring each server has an id
        serverDetails.push(...serverList.servers.map(rawServer => this.enhanceServerDetail(rawServer.server)));
      } catch (error: unknown) {
        console.error(`Failed fetch for registry ${registryURL}`, error);
      }
    }
    return serverDetails.concat(this.internalMCPServers);
  }

  async updateMCPRegistry(registry: kaidenAPI.MCPRegistry): Promise<void> {
    const normalized: kaidenAPI.MCPRegistry = {
      ...registry,
      serverUrl: normalizeMcpRegistryServerUrl(registry.serverUrl),
    };
    const matchingRegistry = this.registries.find(
      existingRegistry => normalized.serverUrl === existingRegistry.serverUrl,
    );
    if (!matchingRegistry) {
      throw new Error(`MCP Registry ${normalized.serverUrl} was not found`);
    }
    this.registries = this.registries.map(r => (r.serverUrl === normalized.serverUrl ? { ...r, ...normalized } : r));
    this.telemetryService.track('updateMCPRegistry', {
      serverUrl: this.getRegistryHash(matchingRegistry),
      total: this.registries.length,
    });
    this.apiSender.send('mcp-registry-update', normalized);
    this._onDidUpdateRegistry.fire(Object.freeze(normalized));
  }

  getOptions(insecure?: boolean): OptionsOfTextResponseBody {
    const httpsOptions: HttpsOptions = {};
    const options: OptionsOfTextResponseBody = {
      https: httpsOptions,
    };

    if (options.https) {
      options.https.certificateAuthority = this.certificates.getAllCertificates();
      if (insecure) {
        options.https.rejectUnauthorized = false;
      }
    }

    if (this.proxyEnabled) {
      // use proxy when performing got request
      const proxy = this.proxySettings;
      const httpProxyUrl = proxy?.httpProxy;
      const httpsProxyUrl = proxy?.httpsProxy;

      if (httpProxyUrl) {
        options.agent ??= {};
        try {
          options.agent.http = new HttpProxyAgent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 256,
            maxFreeSockets: 256,
            scheduling: 'lifo',
            proxy: httpProxyUrl,
          });
        } catch (error) {
          throw new Error(`Failed to create http proxy agent from ${httpProxyUrl}: ${error}`);
        }
      }
      if (httpsProxyUrl) {
        options.agent ??= {};
        try {
          options.agent.https = new HttpsProxyAgent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 256,
            maxFreeSockets: 256,
            scheduling: 'lifo',
            proxy: httpsProxyUrl,
          });
        } catch (error) {
          throw new Error(`Failed to create https proxy agent from ${httpsProxyUrl}: ${error}`);
        }
      }
    }
    return options;
  }

  private loadRegistriesFromConfig(): void {
    this.registries = (this.configuration.get<kaidenAPI.MCPRegistry[]>(MCP_REGISTRIES) ?? []).map(registry => ({
      ...registry,
      serverUrl: normalizeMcpRegistryServerUrl(registry.serverUrl),
      save: true,
    }));
  }

  private saveRegistriesToConfig(): void {
    this.configuration
      .update(
        MCP_REGISTRIES,
        this.registries.filter(registry => registry.save).map(registry => ({ serverUrl: registry.serverUrl })),
      )
      .catch(console.error);
  }
}
