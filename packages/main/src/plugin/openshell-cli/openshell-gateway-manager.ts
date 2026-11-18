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

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { OpenShellClient } from '@nvidia/openshell-sdk';
import { ServiceStatus } from '@nvidia/openshell-sdk/raw';
import { inject, injectable } from 'inversify';

import {
  type GatewayHealth,
  type GatewayMetadata,
  GatewayMetadataSchema,
  type GatewayMetadataSource,
  type GatewayRuntimeInfo,
  GatewayRuntimeInfoSchema,
  type ListedGateway,
} from '/@api/openshell-gateway-info.js';

import { OpenshellGatewayConfig } from './openshell-gateway-config.js';

const SYSTEM_GATEWAY_DIR_ENV = 'OPENSHELL_SYSTEM_GATEWAY_DIR';
// Only used on Linux/macOS; #systemConfigDir() returns undefined on Windows.
const DEFAULT_SYSTEM_CONFIG_DIR = '/etc/openshell';
const METADATA_FILENAME = 'metadata.json';
const ACTIVE_GATEWAY_FILENAME = 'active_gateway';
const GRPC_CALL_TIMEOUT_MS = 10_000;

/**
 * Manages OpenShell gateway registrations by reading and writing the
 * gateway configuration folders directly, mirroring the Rust CLI's
 * `openshell-bootstrap` crate. Also provides runtime gateway info
 * via direct gRPC calls through the SDK transport.
 *
 * Filesystem layout:
 *   User:   $XDG_CONFIG_HOME/openshell/gateways/<name>/metadata.json
 *   System: /etc/openshell/gateways/<name>/metadata.json  (read-only)
 */
@injectable()
export class OpenshellGatewayManager {
  constructor(
    @inject(OpenshellGatewayConfig)
    private readonly gatewayConfig: OpenshellGatewayConfig,
  ) {}

  // ── Config folder CRUD ────────────────────────────────────────────

  async listGateways(): Promise<ListedGateway[]> {
    const gateways: ListedGateway[] = [];
    const seen = new Set<string>();

    const userDir = this.#userGatewaysDir();
    for (const metadata of await this.#scanGatewayDir(userDir)) {
      if (seen.has(metadata.name)) continue;
      seen.add(metadata.name);
      gateways.push({ metadata, source: 'user' });
    }

    const systemDir = this.#systemGatewaysDir();
    if (systemDir) {
      for (const metadata of await this.#scanGatewayDir(systemDir)) {
        if (seen.has(metadata.name)) continue;
        seen.add(metadata.name);
        gateways.push({ metadata, source: 'system' });
      }
    }

    gateways.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
    return gateways;
  }

  async getGateway(name: string): Promise<GatewayMetadata> {
    this.#validateGatewayName(name);
    const userPath = join(this.#userGatewaysDir(), name, METADATA_FILENAME);
    const metadata = await this.#readMetadata(userPath);
    if (metadata) return metadata;

    const systemDir = this.#systemGatewaysDir();
    if (systemDir) {
      const systemPath = join(systemDir, name, METADATA_FILENAME);
      const systemMetadata = await this.#readMetadata(systemPath);
      if (systemMetadata) return systemMetadata;
    }

    throw new Error(`No metadata found for gateway '${name}'`);
  }

  async addGateway(name: string, metadata: GatewayMetadata): Promise<void> {
    this.#validateGatewayName(name);
    const parsed = GatewayMetadataSchema.parse(metadata);
    if (parsed.name !== name) {
      throw new Error(`Gateway metadata name '${parsed.name}' does not match gateway name '${name}'`);
    }
    const source = await this.#gatewayMetadataSource(name);
    if (source === 'user') {
      throw new Error(
        `Gateway '${name}' already exists. Remove it first with removeGateway or choose a different name.`,
      );
    }
    const gatewayDir = join(this.#userGatewaysDir(), name);
    await mkdir(gatewayDir, { recursive: true, mode: 0o700 });
    const metadataPath = join(gatewayDir, METADATA_FILENAME);
    await writeFile(metadataPath, JSON.stringify(parsed, undefined, 2), 'utf-8');
    await this.setActiveGateway(name);
  }

  async removeGateway(name: string): Promise<void> {
    this.#validateGatewayName(name);
    const source = await this.#gatewayMetadataSource(name);
    if (source === 'system') {
      throw new Error(`Gateway '${name}' is installed by the system and cannot be removed from user config.`);
    }
    if (source === undefined) {
      throw new Error(`No gateway metadata found for '${name}'.`);
    }

    const metadataPath = join(this.#userGatewaysDir(), name, METADATA_FILENAME);
    await rm(metadataPath, { force: true });

    const active = await this.getActiveGateway();
    if (active === name) {
      await this.#clearActiveGateway();
    }
  }

  async getActiveGateway(): Promise<string | undefined> {
    const userPath = join(this.#openshellConfigDir(), ACTIVE_GATEWAY_FILENAME);
    const userName = await this.#readTrimmedFile(userPath);
    if (userName) {
      if (!this.#isValidGatewayName(userName)) return undefined;
      return userName;
    }

    const systemDir = this.#systemConfigDir();
    if (systemDir) {
      const systemPath = join(systemDir, ACTIVE_GATEWAY_FILENAME);
      const systemName = await this.#readTrimmedFile(systemPath);
      if (systemName && this.#isValidGatewayName(systemName)) return systemName;
    }

    return undefined;
  }

  async setActiveGateway(name: string): Promise<void> {
    this.#validateGatewayName(name);
    await this.getGateway(name);
    const activePath = join(this.#openshellConfigDir(), ACTIVE_GATEWAY_FILENAME);
    await mkdir(this.#openshellConfigDir(), { recursive: true, mode: 0o700 });
    await writeFile(activePath, name, 'utf-8');
  }

  // ── Runtime methods ────────────────────────────────────────────────

  async getGatewayInfo(gatewayName: string): Promise<GatewayRuntimeInfo> {
    const gateway = await this.getGateway(gatewayName);
    const connectOpts = await this.gatewayConfig.buildConnectOptions({
      name: gateway.name,
      endpoint: gateway.gateway_endpoint,
    });
    const client = await OpenShellClient.connect(connectOpts);
    const response = await client.raw.getGatewayInfo({}, { timeoutMs: GRPC_CALL_TIMEOUT_MS });

    return GatewayRuntimeInfoSchema.parse({
      status: this.#serviceStatusToHealth(response.status),
      gateway_version: response.gatewayVersion,
      compute_drivers: response.computeDrivers.map(d => ({
        name: d.name,
        capabilities: {
          driver_name: d.capabilities?.driverName ?? '',
        },
      })),
    });
  }

  async health(gatewayName: string): Promise<{ status: string; version: string }> {
    const gateway = await this.getGateway(gatewayName);
    const connectOpts = await this.gatewayConfig.buildConnectOptions({
      name: gateway.name,
      endpoint: gateway.gateway_endpoint,
    });
    const client = await OpenShellClient.connect(connectOpts);
    return client.health();
  }

  // ── Path resolution (mirrors Rust openshell-bootstrap) ────────────

  #openshellConfigRoot(): string {
    const xdg = process.env['XDG_CONFIG_HOME'];
    if (xdg) return xdg;

    if (process.platform === 'win32') {
      const appdata = process.env['APPDATA'];
      if (appdata) return appdata;
    }

    return join(process.env['HOME'] ?? homedir(), '.config');
  }

  #openshellConfigDir(): string {
    return join(this.#openshellConfigRoot(), 'openshell');
  }

  #userGatewaysDir(): string {
    return join(this.#openshellConfigDir(), 'gateways');
  }

  #systemConfigDir(): string | undefined {
    const envOverride = process.env[SYSTEM_GATEWAY_DIR_ENV];
    if (envOverride) {
      const trimmed = envOverride.trim();
      if (!trimmed || !isAbsolute(trimmed)) {
        return undefined;
      }
      return trimmed;
    }
    if (process.platform === 'win32') return undefined;
    return DEFAULT_SYSTEM_CONFIG_DIR;
  }

  #systemGatewaysDir(): string | undefined {
    const dir = this.#systemConfigDir();
    return dir ? join(dir, 'gateways') : undefined;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  async #scanGatewayDir(dir: string): Promise<GatewayMetadata[]> {
    const results: GatewayMetadata[] = [];
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (!this.#isValidGatewayName(entry)) continue;
      const metadataPath = join(dir, entry, METADATA_FILENAME);
      if (!this.#userEntryExists(metadataPath)) continue;
      const metadata = await this.#readMetadata(metadataPath);
      if (metadata) {
        results.push(metadata);
      }
    }
    return results;
  }

  async #readMetadata(path: string): Promise<GatewayMetadata | undefined> {
    try {
      const contents = await readFile(path, 'utf-8');
      const parsed = JSON.parse(contents) as unknown;
      return GatewayMetadataSchema.parse(parsed);
    } catch {
      return undefined;
    }
  }

  async #readTrimmedFile(path: string): Promise<string | undefined> {
    try {
      const contents = await readFile(path, 'utf-8');
      const value = contents.trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  async #gatewayMetadataSource(name: string): Promise<GatewayMetadataSource | undefined> {
    const userPath = join(this.#userGatewaysDir(), name, METADATA_FILENAME);
    if (this.#userEntryExists(userPath)) return 'user';

    const systemDir = this.#systemGatewaysDir();
    if (systemDir) {
      const systemPath = join(systemDir, name, METADATA_FILENAME);
      if (existsSync(systemPath)) return 'system';
    }

    return undefined;
  }

  #userEntryExists(metadataPath: string): boolean {
    try {
      return existsSync(metadataPath);
    } catch {
      return true;
    }
  }

  async #clearActiveGateway(): Promise<void> {
    const activePath = join(this.#openshellConfigDir(), ACTIVE_GATEWAY_FILENAME);
    await rm(activePath, { force: true });
  }

  #serviceStatusToHealth(status: ServiceStatus): GatewayHealth {
    switch (status) {
      case ServiceStatus.HEALTHY:
        return 'healthy';
      case ServiceStatus.DEGRADED:
        return 'degraded';
      case ServiceStatus.UNHEALTHY:
        return 'unhealthy';
      default:
        return 'unknown';
    }
  }

  #validateGatewayName(name: string): void {
    if (!this.#isValidGatewayName(name)) {
      throw new Error(`Invalid gateway name '${name}': expected a single path component`);
    }
  }

  #isValidGatewayName(name: string): boolean {
    if (!name || name === '.' || name === '..') return false;
    return !name.includes('/') && !name.includes('\\') && !name.includes('\0');
  }
}
