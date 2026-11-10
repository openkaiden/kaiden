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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { inject, injectable } from 'inversify';

import { Directories } from '/@/plugin/directories.js';

const GATEWAY_MARKER_PREFIX = '# kaiden:gateway=';

/**
 * Manages the SSH config blocks Kaiden installs for OpenShell sandboxes.
 *
 * Host blocks are rendered by the `openshell sandbox ssh-config` command so
 * Kaiden inherits the upstream format, including the `ssh-proxy`
 * `ProxyCommand`. This class only merges them into a Kaiden-owned `ssh_config`
 * file that is included from the user SSH config once.
 *
 * Upstream aliases depend only on the sandbox and workspace, so the same
 * sandbox name on two gateways would share an alias and the second install
 * would overwrite the first. To keep both reachable, each block records its
 * gateway in a `# kaiden:gateway=<name>` comment line; when another gateway
 * already owns the upstream alias, Kaiden appends the gateway to it
 * (`openshell-<sandbox>.<workspace>.<gateway>`).
 */
@injectable()
export class OpenshellSshConfig {
  constructor(
    @inject(Directories)
    private readonly directories: Directories,
  ) {}

  /**
   * Installs the block under an alias unique to its gateway and returns the
   * alias that was used.
   */
  async installHost(baseAlias: string, hostBlock: string, gatewayName: string): Promise<string> {
    const managedConfig = join(this.directories.getConfigurationDirectory(), 'ssh_config');
    const lines = this.#toLines(await this.#readFileOrEmpty(managedConfig));
    const alias = this.#resolveAlias(lines, baseAlias, gatewayName);
    const block = this.#renderHostBlock(hostBlock, alias, gatewayName);
    await mkdir(dirname(managedConfig), { recursive: true });
    this.#upsertHostBlock(lines, alias, block);
    await writeFile(managedConfig, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf-8');
    await this.#ensureInclude(this.userSshConfigPath(), managedConfig);
    return alias;
  }

  /**
   * Path of the user SSH config the managed config is included from. Protected
   * so tests can redirect it away from the real home directory.
   */
  protected userSshConfigPath(): string {
    return join(homedir(), '.ssh', 'config');
  }

  #resolveAlias(lines: string[], baseAlias: string, gatewayName: string): string {
    const owner = this.#gatewayOwner(lines, baseAlias);
    return owner === undefined || owner === gatewayName ? baseAlias : `${baseAlias}.${gatewayName}`;
  }

  #renderHostBlock(hostBlock: string, alias: string, gatewayName: string): string {
    const lines = hostBlock.split('\r\n').join('\n').trimEnd().split('\n');
    const hostIndex = lines.findIndex(line => this.#isHostLine(line));
    if (hostIndex === -1) {
      throw new Error(`cannot install an SSH host block without a Host line for alias "${alias}"`);
    }
    lines[hostIndex] = `Host ${alias}`;
    return [`${GATEWAY_MARKER_PREFIX}${gatewayName}`, ...lines].join('\n');
  }

  #gatewayOwner(lines: string[], alias: string): string | undefined {
    const hostIndex = this.#findHostIndex(lines, alias);
    if (hostIndex === -1) {
      return undefined;
    }
    const marker = lines[this.#blockStart(lines, hostIndex)];
    return marker ? this.#markerGateway(marker) : undefined;
  }

  #markerGateway(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith(GATEWAY_MARKER_PREFIX)) {
      return undefined;
    }
    return trimmed.slice(GATEWAY_MARKER_PREFIX.length).trim() || undefined;
  }

  #isGatewayMarker(line: string | undefined): boolean {
    return line?.trim().startsWith(GATEWAY_MARKER_PREFIX) ?? false;
  }

  /** First line of the block owning `hostIndex`, including its gateway marker. */
  #blockStart(lines: string[], hostIndex: number): number {
    const markerIndex = hostIndex - 1;
    return markerIndex >= 0 && this.#isGatewayMarker(lines[markerIndex]) ? markerIndex : hostIndex;
  }

  #upsertHostBlock(lines: string[], alias: string, block: string): void {
    const hostIndex = this.#findHostIndex(lines, alias);
    if (hostIndex === -1) {
      this.#appendBlock(lines, block);
      return;
    }
    const start = this.#blockStart(lines, hostIndex);
    let end = lines.length;
    for (let i = hostIndex + 1; i < lines.length; i++) {
      if (this.#isHostLine(lines[i] ?? '')) {
        end = this.#blockStart(lines, i);
        break;
      }
    }
    const trailing = lines.slice(end);
    lines.length = start;
    this.#appendBlock(lines, block);
    if (trailing.length > 0 && trailing[0] !== '') {
      lines.push('');
    }
    lines.push(...trailing);
  }

  #appendBlock(lines: string[], block: string): void {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }
    lines.push(...block.split('\n'));
  }

  async #ensureInclude(userConfig: string, managedConfig: string): Promise<void> {
    const contents = await this.#readFileOrEmpty(userConfig);
    if (this.#includesPath(contents, managedConfig)) {
      return;
    }
    await mkdir(dirname(userConfig), { recursive: true });
    const lines = this.#toLines(contents);
    const includeLine = `Include "${managedConfig}"`;
    let insertAt = lines.findIndex(line => {
      const trimmed = line.trimStart();
      return trimmed.startsWith('Host ') || trimmed.startsWith('Match ');
    });
    if (insertAt === -1) {
      insertAt = lines.length;
    }
    const updated: string[] = [...lines.slice(0, insertAt)];
    if (updated.length > 0 && updated[updated.length - 1] !== '') {
      updated.push('');
    }
    updated.push(includeLine);
    if (insertAt < lines.length && lines[insertAt] !== '') {
      updated.push('');
    }
    updated.push(...lines.slice(insertAt));
    await writeFile(userConfig, updated.length > 0 ? `${updated.join('\n')}\n` : '', 'utf-8');
  }

  #includesPath(contents: string, path: string): boolean {
    const quoted = `"${path}"`;
    return this.#toLines(contents).some(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('Include ')) {
        return false;
      }
      return trimmed
        .slice('Include '.length)
        .split(/\s+/)
        .some(token => token === quoted || token === path);
    });
  }

  #toLines(contents: string): string[] {
    const normalized = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
    return normalized === '' ? [] : normalized.split('\n');
  }

  #findHostIndex(lines: string[], hostAlias: string): number {
    return lines.findIndex(line => this.#hostLineMatchesAlias(line, hostAlias));
  }

  #isHostLine(line: string): boolean {
    return line.trimStart().startsWith('Host ');
  }

  #hostLineMatchesAlias(line: string, hostAlias: string): boolean {
    if (!this.#isHostLine(line)) {
      return false;
    }
    return line
      .trimStart()
      .slice('Host '.length)
      .split(/\s+/)
      .some(token => token === hostAlias);
  }

  async #readFileOrEmpty(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf-8');
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return '';
      }
      console.error(`[openshell-ssh-config] failed to read "${path}":`, err);
      throw err;
    }
  }
}
