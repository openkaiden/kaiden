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

const PROXY_COMMAND_PREFIX = 'ProxyCommand ';
const PROXY_SUBCOMMAND = 'ssh-proxy';
const GATEWAY_ARGUMENT = '--gateway-name';
const SANDBOX_ARGUMENT = '--name';

interface HostBlockRange {
  /** Index of the `Host` line. */
  start: number;
  /** Index of the line following the block, or the end of the file. */
  end: number;
}

/**
 * Sandbox and gateway a host block tunnels to, as declared by its
 * `ProxyCommand`.
 */
interface ProxyIdentity {
  sandbox: string;
  gateway: string;
}

/**
 * Manages the SSH config blocks Kaiden installs for OpenShell sandboxes.
 *
 * Host blocks are rendered by the `openshell sandbox ssh-config` command so
 * Kaiden inherits the upstream format, including the `ssh-proxy`
 * `ProxyCommand`. This class only merges them into a Kaiden-owned `ssh_config`
 * file that is included from the user SSH config once.
 *
 * The `Include` line is kept at the very top of the user SSH config, ahead of
 * every other directive: OpenSSH locks in each parameter at first match, so an
 * `Include` placed after a `Host` block (or after stray global directives)
 * never applies.
 *
 * A block is identified by the `--gateway-name` and `--name` values of its
 * `ProxyCommand`, which is what actually routes the connection. Upstream
 * aliases depend only on the sandbox and workspace, so the same sandbox name
 * on two gateways would share an alias and the second install would replace
 * the first block. When another gateway already owns the upstream alias,
 * Kaiden appends the gateway to it
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
    const block = this.#renderHostBlock(hostBlock, alias);
    await mkdir(dirname(managedConfig), { recursive: true, mode: 0o700 });
    this.#upsertHostBlock(lines, alias, block);
    await this.#writeLines(managedConfig, lines);
    await this.#ensureInclude(this.userSshConfigPath(), managedConfig);
    return alias;
  }

  /**
   * Removes the host blocks tunnelling to `sandboxName` on `gatewayName`.
   *
   * Blocks are matched on their `ProxyCommand` values only, so blocks written
   * by older builds or edited by hand are removed as well as long as they
   * still call `ssh-proxy` for that sandbox and gateway. Returns the number of
   * removed blocks.
   */
  async removeHost(sandboxName: string, gatewayName: string): Promise<number> {
    const managedConfig = join(this.directories.getConfigurationDirectory(), 'ssh_config');
    const lines = this.#toLines(await this.#readFileOrEmpty(managedConfig));
    const spans = this.#hostBlockRanges(lines)
      .filter(range => this.#isIdentity(lines, range, sandboxName, gatewayName))
      .map(range => this.#removalSpan(lines, range));
    if (spans.length === 0) {
      return 0;
    }
    for (let index = spans.length - 1; index >= 0; index--) {
      const span = spans[index];
      if (span) {
        lines.splice(span.start, span.end - span.start);
        this.#isolateBlockAt(lines, span.start);
      }
    }
    await this.#writeLines(managedConfig, lines);
    return spans.length;
  }

  /**
   * Path of the user SSH config the managed config is included from. Protected
   * so tests can redirect it away from the real home directory.
   */
  protected userSshConfigPath(): string {
    return join(homedir(), '.ssh', 'config');
  }

  #resolveAlias(lines: string[], baseAlias: string, gatewayName: string): string {
    const range = this.#findHostRange(lines, baseAlias);
    if (!range) {
      return baseAlias;
    }
    const owner = this.#blockIdentity(lines, range)?.gateway;
    return owner === undefined || owner === gatewayName ? baseAlias : `${baseAlias}.${gatewayName}`;
  }

  #renderHostBlock(hostBlock: string, alias: string): string {
    const lines = hostBlock.split('\r\n').join('\n').trimEnd().split('\n');
    const hostIndex = lines.findIndex(line => this.#isHostLine(line));
    if (hostIndex === -1) {
      throw new Error(`cannot install an SSH host block without a Host line for alias "${alias}"`);
    }
    lines[hostIndex] = `Host ${alias}`;
    return lines.join('\n');
  }

  #upsertHostBlock(lines: string[], alias: string, block: string): void {
    const range = this.#findHostRange(lines, alias);
    if (!range) {
      this.#appendBlock(lines, block);
      return;
    }
    const trailing = lines.slice(range.end);
    lines.length = range.start;
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

  /** Re-adds the blank separator a removed block used to provide. */
  #isolateBlockAt(lines: string[], index: number): void {
    const previous = index > 0 ? lines[index - 1] : undefined;
    const next = index < lines.length ? lines[index] : undefined;
    if (previous !== undefined && next !== undefined && previous !== '' && next !== '') {
      lines.splice(index, 0, '');
    }
  }

  async #ensureInclude(userConfig: string, managedConfig: string): Promise<void> {
    const contents = await this.#readFileOrEmpty(userConfig);
    const lines = this.#toLines(contents);
    const includeLine = `Include "${managedConfig}"`;
    const updated: string[] = [includeLine];
    const remainder = this.#withoutInclude(lines, managedConfig);
    if (remainder.length > 0) {
      updated.push('', ...remainder);
    }
    if (updated.length === lines.length && updated.every((line, index) => line === lines[index])) {
      return;
    }
    await mkdir(dirname(userConfig), { recursive: true, mode: 0o700 });
    await this.#writeLines(userConfig, updated);
  }

  /**
   * Drops every `Include` of the managed config so it can be re-added at the
   * top, and strips leading blank lines so they do not pile up under it.
   */
  #withoutInclude(lines: string[], path: string): string[] {
    const filtered = lines.filter(line => !this.#isManagedInclude(line, path));
    const firstContent = filtered.findIndex(line => line !== '');
    return firstContent === -1 ? [] : filtered.slice(firstContent);
  }

  #isManagedInclude(line: string, path: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('Include ')) {
      return false;
    }
    const quoted = `"${path}"`;
    return trimmed
      .slice('Include '.length)
      .split(/\s+/)
      .some(token => token === quoted || token === path);
  }

  #hostBlockRanges(lines: string[]): HostBlockRange[] {
    const ranges: HostBlockRange[] = [];
    for (let index = 0; index < lines.length; index++) {
      if (!this.#isHostLine(lines[index] ?? '')) {
        continue;
      }
      const previous = ranges[ranges.length - 1];
      if (previous) {
        previous.end = index;
      }
      ranges.push({ start: index, end: lines.length });
    }
    return ranges;
  }

  #findHostRange(lines: string[], hostAlias: string): HostBlockRange | undefined {
    return this.#hostBlockRanges(lines).find(range => this.#hostLineMatchesAlias(lines[range.start] ?? '', hostAlias));
  }

  #isIdentity(lines: string[], range: HostBlockRange, sandboxName: string, gatewayName: string): boolean {
    const identity = this.#blockIdentity(lines, range);
    return identity?.sandbox === sandboxName && identity.gateway === gatewayName;
  }

  /** Sandbox and gateway the block at `range` tunnels to, if it declares them. */
  #blockIdentity(lines: string[], range: HostBlockRange): ProxyIdentity | undefined {
    const proxyLine = lines
      .slice(range.start, range.end)
      .find(line => line.trimStart().startsWith(PROXY_COMMAND_PREFIX));
    return proxyLine ? this.#proxyIdentity(proxyLine) : undefined;
  }

  #proxyIdentity(line: string): ProxyIdentity | undefined {
    const words = this.#shellWords(line.trimStart().slice(PROXY_COMMAND_PREFIX.length));
    const proxyIndex = words.indexOf(PROXY_SUBCOMMAND);
    if (proxyIndex === -1) {
      return undefined;
    }
    const args = words.slice(proxyIndex + 1);
    const gateway = this.#argumentValue(args, GATEWAY_ARGUMENT);
    const sandbox = this.#argumentValue(args, SANDBOX_ARGUMENT);
    return gateway !== undefined && sandbox !== undefined ? { sandbox, gateway } : undefined;
  }

  #argumentValue(words: string[], flag: string): string | undefined {
    const index = words.indexOf(flag);
    return index === -1 ? undefined : words[index + 1];
  }

  /** Splits a command line into words, dropping single quotes like a shell. */
  #shellWords(command: string): string[] {
    const words: string[] = [];
    let current = '';
    let started = false;
    let quoted = false;
    for (const char of command) {
      if (char === "'") {
        quoted = !quoted;
        started = true;
        continue;
      }
      if (!quoted && /\s/.test(char)) {
        if (started) {
          words.push(current);
          current = '';
          started = false;
        }
        continue;
      }
      current += char;
      started = true;
    }
    if (started) {
      words.push(current);
    }
    return words;
  }

  /** Range to delete for a block, including its blank separator. */
  #removalSpan(lines: string[], range: HostBlockRange): HostBlockRange {
    if (range.start > 0 && lines[range.start - 1] === '') {
      return { start: range.start - 1, end: range.end };
    }
    if (range.end < lines.length && lines[range.end] === '') {
      return { start: range.start, end: range.end + 1 };
    }
    return range;
  }

  #toLines(contents: string): string[] {
    const normalized = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
    return normalized === '' ? [] : normalized.split('\n');
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

  async #writeLines(path: string, lines: string[]): Promise<void> {
    await writeFile(path, lines.length > 0 ? `${lines.join('\n')}\n` : '', { encoding: 'utf-8', mode: 0o600 });
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
