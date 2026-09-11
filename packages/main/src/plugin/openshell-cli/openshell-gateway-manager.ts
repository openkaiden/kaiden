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
import { connect as h2Connect, constants as h2constants } from 'node:http2';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { inject, injectable } from 'inversify';

import {
  type GatewayMetadata,
  GatewayMetadataSchema,
  type GatewayMetadataSource,
  type GatewayRuntimeInfo,
  GatewayRuntimeInfoSchema,
  type ListedGateway,
} from '/@api/openshell-gateway-info.js';

import { OpenshellGatewayConfig } from './openshell-gateway-config.js';
import { OpenshellSdkClientManager } from './openshell-sdk-client-manager.js';

const SYSTEM_GATEWAY_DIR_ENV = 'OPENSHELL_SYSTEM_GATEWAY_DIR';
const DEFAULT_SYSTEM_CONFIG_DIR = '/etc/openshell';
const METADATA_FILENAME = 'metadata.json';
const ACTIVE_GATEWAY_FILENAME = 'active_gateway';

const GRPC_GET_GATEWAY_INFO_PATH = '/openshell.v1.OpenShell/GetGatewayInfo';
const GRPC_CALL_TIMEOUT_MS = 10_000;
const GRPC_MAX_RESPONSE_BYTES = 1024 * 1024;

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
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
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
  //
  // GetGatewayInfo is not in the SDK's TypeScript codegen, so we call it
  // as a raw gRPC unary request over HTTP/2 with a minimal protobuf
  // decoder for the known response shape.

  async getGatewayInfo(gatewayName?: string): Promise<GatewayRuntimeInfo> {
    const gateway = await this.#resolveGateway(gatewayName);
    const connectOpts = await this.gatewayConfig.buildConnectOptions({
      name: gateway.name,
      endpoint: gateway.gateway_endpoint,
    });

    const responseBytes = await this.#grpcUnaryCall(connectOpts.gateway, GRPC_GET_GATEWAY_INFO_PATH, Buffer.alloc(0), {
      ca: connectOpts.caCert,
      cert: connectOpts.clientCert,
      key: connectOpts.clientKey,
    });

    return GatewayRuntimeInfoSchema.parse(decodeGetGatewayInfoResponse(responseBytes));
  }

  async health(gatewayName?: string): Promise<{ status: string; version: string }> {
    const client = await this.sdkClientManager.getClient(gatewayName);
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

  async #resolveGateway(gatewayName?: string): Promise<GatewayMetadata> {
    if (gatewayName) return this.getGateway(gatewayName);

    const activeName = await this.getActiveGateway();
    if (activeName) return this.getGateway(activeName);

    const all = await this.listGateways();
    if (all.length === 1) return all[0]!.metadata;
    if (all.length === 0) throw new Error('No OpenShell gateways registered');
    throw new Error('Multiple OpenShell gateways registered but none is active');
  }

  #grpcUnaryCall(
    gatewayUrl: string,
    rpcPath: string,
    requestMessage: Buffer,
    tlsOpts: { ca?: Buffer; cert?: Buffer; key?: Buffer },
  ): Promise<Buffer> {
    const grpcFrame = Buffer.alloc(5 + requestMessage.length);
    grpcFrame.writeUInt8(0, 0);
    grpcFrame.writeUInt32BE(requestMessage.length, 1);
    requestMessage.copy(grpcFrame, 5);

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn: typeof resolve | typeof reject, value: Buffer | Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        (fn as (v: Buffer | Error) => void)(value);
      };

      const timer = setTimeout(() => {
        settle(reject, new Error('GetGatewayInfo gRPC call timed out'));
        session.destroy();
      }, GRPC_CALL_TIMEOUT_MS);

      const url = new URL(gatewayUrl);
      const isHttps = url.protocol === 'https:';

      const session = h2Connect(url.origin, {
        ...(isHttps ? { ca: tlsOpts.ca, cert: tlsOpts.cert, key: tlsOpts.key } : {}),
      });

      session.on('error', err => {
        settle(reject, err);
        session.destroy();
      });

      const req = session.request({
        [h2constants.HTTP2_HEADER_METHOD]: 'POST',
        [h2constants.HTTP2_HEADER_PATH]: rpcPath,
        [h2constants.HTTP2_HEADER_CONTENT_TYPE]: 'application/grpc',
        te: 'trailers',
      });

      let statusCode = 0;
      let grpcStatus = -1;
      let grpcMessage = '';

      req.on('response', headers => {
        statusCode = Number(headers[h2constants.HTTP2_HEADER_STATUS]) || 0;
      });

      req.on('trailers', (trailers: Record<string, string>) => {
        if (trailers['grpc-status'] !== undefined) {
          grpcStatus = Number(trailers['grpc-status']);
        }
        if (trailers['grpc-message']) {
          try {
            grpcMessage = decodeURIComponent(trailers['grpc-message']);
          } catch {
            grpcMessage = trailers['grpc-message'];
          }
        }
      });

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      req.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > GRPC_MAX_RESPONSE_BYTES) {
          settle(reject, new Error('GetGatewayInfo gRPC response exceeded maximum size'));
          req.destroy();
          session.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        session.close();
        if (statusCode !== 200) {
          settle(reject, new Error(`GetGatewayInfo gRPC call failed (HTTP ${statusCode})`));
          return;
        }
        if (grpcStatus > 0) {
          settle(reject, new Error(`GetGatewayInfo gRPC error (status ${grpcStatus}): ${grpcMessage}`));
          return;
        }
        const body = Buffer.concat(chunks);
        if (body.length < 5) {
          settle(reject, new Error('GetGatewayInfo gRPC response too short'));
          return;
        }
        const msgLen = body.readUInt32BE(1);
        if (body.length < 5 + msgLen) {
          settle(reject, new Error('GetGatewayInfo gRPC response truncated'));
          return;
        }
        settle(resolve, body.subarray(5, 5 + msgLen));
      });
      req.on('error', err => {
        session.destroy();
        settle(reject, err);
      });

      req.write(grpcFrame);
      req.end();
    });
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

// ── Minimal protobuf decoder for GetGatewayInfoResponse ─────────────
//
// Decodes the known wire structure without requiring @bufbuild/protobuf.
// Proto layout:
//   GetGatewayInfoResponse { ServiceStatus status=1; string gateway_version=2; repeated ComputeDriverInfo compute_drivers=3; }
//   ComputeDriverInfo      { string name=1; ComputeDriverCapabilities capabilities=2; }
//   ComputeDriverCapabilities { string driver_name=1; string driver_version=2; }

const SERVICE_STATUS_NAMES: Record<number, string> = { 0: 'unknown', 1: 'healthy', 2: 'degraded', 3: 'unhealthy' };

interface ProtoField {
  fieldNumber: number;
  wireType: number;
  value: number | Buffer;
}

function readVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  const maxBytes = Math.min(offset + 5, buf.length);
  while (pos < maxBytes) {
    const byte = buf[pos]!;
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) return [result >>> 0, pos];
    shift += 7;
  }
  return [result >>> 0, pos];
}

function parseFields(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const [tag, afterTag] = readVarint(buf, offset);
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x07;
    offset = afterTag;

    if (wireType === 0) {
      const [value, afterValue] = readVarint(buf, offset);
      fields.push({ fieldNumber, wireType, value });
      offset = afterValue;
    } else if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, offset);
      if (len > buf.length - afterLen) break;
      fields.push({ fieldNumber, wireType, value: buf.subarray(afterLen, afterLen + len) });
      offset = afterLen + len;
    } else {
      break;
    }
  }
  return fields;
}

function decodeCapabilities(buf: Buffer): { driver_name: string; driver_version: string } {
  const result = { driver_name: '', driver_version: '' };
  for (const f of parseFields(buf)) {
    if (f.fieldNumber === 1 && Buffer.isBuffer(f.value)) result.driver_name = f.value.toString('utf-8');
    if (f.fieldNumber === 2 && Buffer.isBuffer(f.value)) result.driver_version = f.value.toString('utf-8');
  }
  return result;
}

function decodeComputeDriver(buf: Buffer): {
  name: string;
  capabilities: { driver_name: string; driver_version: string };
} {
  let name = '';
  let capabilities = { driver_name: '', driver_version: '' };
  for (const f of parseFields(buf)) {
    if (f.fieldNumber === 1 && Buffer.isBuffer(f.value)) name = f.value.toString('utf-8');
    if (f.fieldNumber === 2 && Buffer.isBuffer(f.value)) capabilities = decodeCapabilities(f.value);
  }
  return { name, capabilities };
}

function decodeGetGatewayInfoResponse(buf: Buffer): {
  status: string;
  gateway_version: string;
  compute_drivers: { name: string; capabilities: { driver_name: string; driver_version: string } }[];
} {
  let status = 'unknown';
  let gateway_version = '';
  const compute_drivers: { name: string; capabilities: { driver_name: string; driver_version: string } }[] = [];

  for (const f of parseFields(buf)) {
    if (f.fieldNumber === 1 && typeof f.value === 'number') {
      status = SERVICE_STATUS_NAMES[f.value] ?? 'unknown';
    }
    if (f.fieldNumber === 2 && Buffer.isBuffer(f.value)) {
      gateway_version = f.value.toString('utf-8');
    }
    if (f.fieldNumber === 3 && Buffer.isBuffer(f.value)) {
      compute_drivers.push(decodeComputeDriver(f.value));
    }
  }

  return { status, gateway_version, compute_drivers };
}
