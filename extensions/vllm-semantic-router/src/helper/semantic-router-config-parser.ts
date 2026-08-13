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

import { isIP } from 'node:net';

import { injectable } from 'inversify';
import { parse } from 'yaml';
import { z } from 'zod';

import { type SRBackendRef, type SRConfig, SRConfigSchema, type SRModel } from '/@/api/sr-config-schema';

// validates what the user provides when creating a semantic router, before anything is created
@injectable()
export class SemanticRouterConfigParser {
  /**
   * The name is used as a folder name for the router configuration, so it must be valid on all platforms.
   */
  validateName(name: string): void {
    const invalid = (reason: string): Error => new Error(`Invalid semantic router name '${name}': ${reason}`);
    if (name.trim().length === 0) {
      throw invalid('name must not be empty');
    }
    if (name.length > 255) {
      throw invalid('name must not exceed 255 characters');
    }
    if (/[<>:"/\\|?*]/.test(name) || [...name].some(c => c.charCodeAt(0) < 0x20)) {
      throw invalid('name must not contain any of < > : " / \\ | ? * or control characters');
    }
    // also rejects '.' and '..'
    if (/[. ]$/.test(name)) {
      throw invalid('name must not end with a dot or a space');
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
      throw invalid('name is a reserved system name');
    }
  }

  parseConfig(config: string): SRConfig {
    let raw: unknown;
    try {
      raw = parse(config);
    } catch (err: unknown) {
      throw new Error(`Invalid semantic router configuration: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    const result = SRConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid semantic router configuration: ${z.prettifyError(result.error)}`, {
        cause: result.error,
      });
    }
    this.validateListeners(result.data);
    const modelNames = new Set<string>();
    for (const model of result.data.providers.models) {
      // the model name is the envoy cluster name and the routing key
      if (modelNames.has(model.name)) {
        throw new Error(`Invalid semantic router configuration: model '${model.name}' is defined more than once`);
      }
      modelNames.add(model.name);
      // envoy routes each model to a single backend
      if (model.backend_refs.length !== 1) {
        throw new Error(
          `Invalid semantic router configuration: model '${model.name}' must have exactly one backend_refs entry, found ${model.backend_refs.length}`,
        );
      }
      for (const ref of model.backend_refs) {
        this.parseBackendEndpoint(model, ref);
      }
    }
    return result.data;
  }

  // the listener is where envoy is published on the host: its address, port and timeout are all used
  private validateListeners(srConfig: SRConfig): void {
    const invalid = (reason: string): Error => new Error(`Invalid semantic router configuration: ${reason}`);
    if (srConfig.listeners.length !== 1) {
      throw invalid(`exactly one listener is required, found ${srConfig.listeners.length}`);
    }
    const [{ address, port, timeout }] = srConfig.listeners;
    if (!isIP(address)) {
      throw invalid(`listener address '${address}' must be an IP address`);
    }
    // a port of 0 or less means that a free port is picked
    if (port > 0 && (port < 1024 || port > 65535)) {
      throw invalid(`listener port ${port} must be between 1024 and 65535`);
    }
    if (timeout !== undefined && !/^[1-9]\d*s$/.test(timeout)) {
      throw invalid(`listener timeout '${timeout}' must be a number of seconds such as '300s'`);
    }
  }

  /**
   * Parses a backend endpoint (`host[:port][/path]`, IPv6 hosts in brackets). The path is ignored.
   * The port defaults to 80 for http and 443 otherwise.
   */
  parseBackendEndpoint(model: SRModel, ref: SRBackendRef): { hostname: string; port: number } {
    const invalid = (reason: string, cause?: unknown): Error =>
      new Error(
        `Invalid semantic router configuration: model '${model.name}' has invalid endpoint '${ref.endpoint}': ${reason}`,
        { cause },
      );
    if (ref.endpoint.includes('://')) {
      throw invalid('the endpoint must not include a scheme, use the protocol field instead');
    }
    let url: URL;
    try {
      url = new URL(`${ref.protocol}://${ref.endpoint}`);
    } catch (err: unknown) {
      throw invalid('expected host[:port] with a port between 0 and 65535 and IPv6 hosts in brackets', err);
    }
    const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
    if (!hostname) {
      throw invalid('the host is missing');
    }
    const port = url.port ? Number(url.port) : ref.protocol === 'http' ? 80 : 443;
    return { hostname, port };
  }
}
