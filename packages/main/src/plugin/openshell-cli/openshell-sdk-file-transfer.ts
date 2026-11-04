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

import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { SdkError } from '@nvidia/openshell-sdk';
import { inject, injectable } from 'inversify';
import type { Pack, PackOptions } from 'tar-fs';
import tar from 'tar-fs';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { Exec } from '/@/plugin/util/exec.js';

interface UploadTarget {
  client: OpenShellClient;
  sandboxName: string;
  localPath: string;
  dest: string;
}

interface RemoteResult {
  exitCode: number;
  stderr: string;
}

/**
 * Uploads local files to an OpenShell sandbox via tar-over-exec,
 * replacing the CLI `openshell sandbox upload` command.
 *
 * The archive is built by `tar-fs` as a stream (with backpressure) and sent as
 * stdin of remote commands through the SDK's `execInteractive` with `tty: false`:
 * - archives up to {@link OpenshellSdkFileTransfer.UPLOAD_PART_BYTES} are extracted by a single
 *   `tar xf -` exec;
 * - larger archives are staged as part files in the sandbox, one short exec
 *   per part, then concatenated into `tar xf -` and removed.
 *
 * Like the CLI, a directory is extracted as `<dest>/<basename>/...` (not
 * flattened into `<dest>`), and directories inside a Git work tree only include
 * the files reported by `git ls-files -co --exclude-standard` (i.e.
 * `.gitignore` rules apply).
 */
@injectable()
export class OpenshellSdkFileTransfer {
  protected static readonly MAX_RETRIES = 3;
  protected static readonly INITIAL_BACKOFF_MS = 500;
  protected static readonly STDIN_CHUNK_BYTES = 64 * 1024;
  /**
   * Archive bytes sent per exec. Exec stdin has no flow control: the sandbox
   * supervisor kills the command (exit 74, "process stdin buffer is full") once
   * more than 4 MiB is waiting for the process to read it. Keeping every exec's
   * stdin well below that budget makes overflow impossible.
   */
  protected static readonly UPLOAD_PART_BYTES = 2 * 1024 * 1024;
  protected static readonly REMOTE_STAGING_ROOT = '/tmp';
  /** gRPC status `UNAVAILABLE` (connect-es `Code.Unavailable`, which the SDK does not re-export). */
  protected static readonly GRPC_UNAVAILABLE = 14;

  constructor(
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
    @inject(Exec)
    private readonly exec: Exec,
  ) {}

  async uploadToSandbox(sandboxName: string, localPath: string, dest: string, gatewayName?: string): Promise<void> {
    const stat = await lstat(localPath);
    let extractDir: string;
    let archiveName: string | undefined;

    if (stat.isDirectory()) {
      extractDir = dest;
    } else if (dest.endsWith('/')) {
      extractDir = dest;
    } else {
      // scp-style: dest is the target filename
      extractDir = posix.dirname(dest);
      archiveName = posix.basename(dest);
    }

    const gitFiles = stat.isDirectory() ? await this.#listUploadableGitFiles(localPath) : undefined;
    if (gitFiles?.length === 0) {
      throw new Error(
        `Git filtering selected no files for "${localPath}": the directory is empty or all its files are ignored`,
      );
    }

    const client = await this.sdkClientManager.getClient(gatewayName);
    const target: UploadTarget = { client, sandboxName, localPath, dest };

    const archive = this.#createArchive(localPath, stat, archiveName, gitFiles);
    try {
      await this.#sendArchive(target, archive, extractDir);
    } catch (err: unknown) {
      // Stop reading local files: nothing will consume the rest of the archive.
      archive.destroy();
      throw err;
    }
  }

  /**
   * Builds the upload archive with `tar-fs`, mirroring `openshell sandbox upload`:
   * - a directory is wrapped under its basename (`<dest>/<basename>/...`), except
   *   for paths without a meaningful basename (such as `/`), which stay flat;
   * - Git-filtered directories only include the listed files (under the same prefix);
   * - a single file or symlink is renamed to `archiveName` for scp-style destinations.
   * Symlinks are preserved (not followed) and sockets, FIFOs and devices are skipped.
   */
  #createArchive(
    localPath: string,
    stat: Stats,
    archiveName: string | undefined,
    gitFiles: string[] | undefined,
  ): Pack {
    if (stat.isDirectory()) {
      const prefix = this.#directoryPrefix(localPath);
      const options: PackOptions = { strict: false };
      if (gitFiles) {
        options.entries = gitFiles.map(file => (prefix ? `${prefix}/${file}` : file));
      } else if (prefix) {
        options.entries = [prefix];
      }
      return tar.pack(prefix ? dirname(localPath) : localPath, options);
    }
    const name = archiveName ?? basename(localPath);
    return tar.pack(dirname(localPath), {
      entries: [basename(localPath)],
      strict: false,
      map: header => ({ ...header, name }),
    });
  }

  async #sendArchive(target: UploadTarget, archive: Pack, extractDir: string): Promise<void> {
    const escapedDir = this.#remotePath(extractDir);
    const parts = this.#readParts(archive);

    const extractFromStdin = `mkdir -p -- ${escapedDir} && tar xf - -C ${escapedDir}`;
    const first = await parts.next();
    if (first.done) {
      // Unreachable in practice: a finalized archive always has an end-of-archive block.
      await this.#runRemote(target, 'tar extraction', extractFromStdin);
      return;
    }
    const second = await parts.next();
    if (second.done) {
      await this.#runRemote(target, 'tar extraction', extractFromStdin, first.value);
      return;
    }

    const stagingDir = this.#shellEscape(
      `${OpenshellSdkFileTransfer.REMOTE_STAGING_ROOT}/kaiden-upload-${randomUUID()}`,
    );
    try {
      await this.#stagePart(target, stagingDir, 0, first.value);
      await this.#stagePart(target, stagingDir, 1, second.value);
      let index = 2;
      for (let part = await parts.next(); !part.done; part = await parts.next()) {
        await this.#stagePart(target, stagingDir, index++, part.value);
      }
      await this.#runRemote(
        target,
        'tar extraction',
        `mkdir -p -- ${escapedDir} && cat ${stagingDir}/part-* | tar xf - -C ${escapedDir}`,
      );
    } finally {
      await this.#removeStagingDir(target, stagingDir);
    }
  }

  async #stagePart(target: UploadTarget, stagingDir: string, index: number, data: Buffer): Promise<void> {
    // Fixed part names keep a retried exec idempotent; zero padding keeps the
    // `part-*` glob in archive order.
    const partName = `part-${String(index).padStart(6, '0')}`;
    await this.#runRemote(
      target,
      'upload staging',
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/${partName}`,
      data,
    );
  }

  async #removeStagingDir(target: UploadTarget, stagingDir: string): Promise<void> {
    try {
      const result = await this.#execOnce(target, `rm -rf -- ${stagingDir}`, Buffer.alloc(0));
      if (result.exitCode !== 0) {
        console.warn(
          `[openshell-file-transfer] failed to remove staging directory ${stagingDir} in "${target.sandboxName}" (exit code ${result.exitCode}): ${result.stderr}`,
        );
      }
    } catch (err: unknown) {
      console.warn(
        `[openshell-file-transfer] failed to remove staging directory ${stagingDir} in "${target.sandboxName}":`,
        err,
      );
    }
  }

  /** Splits the archive stream into buffers of {@link OpenshellSdkFileTransfer.UPLOAD_PART_BYTES} (the last one may be shorter). */
  async *#readParts(archive: Pack): AsyncGenerator<Buffer, void, void> {
    let buffered: Buffer[] = [];
    let size = 0;
    for await (const chunk of archive) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      buffered.push(data);
      size += data.length;
      while (size >= OpenshellSdkFileTransfer.UPLOAD_PART_BYTES) {
        const all = Buffer.concat(buffered, size);
        yield all.subarray(0, OpenshellSdkFileTransfer.UPLOAD_PART_BYTES);
        const rest = all.subarray(OpenshellSdkFileTransfer.UPLOAD_PART_BYTES);
        buffered = rest.length > 0 ? [rest] : [];
        size = rest.length;
      }
    }
    if (size > 0) {
      yield Buffer.concat(buffered, size);
    }
  }

  /** Runs `script` with `stdin`, retrying transient transport errors, and throws on a non-zero exit code. */
  async #runRemote(
    target: UploadTarget,
    operation: string,
    script: string,
    stdin: Buffer = Buffer.alloc(0),
  ): Promise<void> {
    const result = await this.#execWithRetry(target, operation, script, stdin);
    if (result.exitCode !== 0) {
      const detail = result.stderr ? ` (${result.stderr})` : '';
      throw new Error(
        `${operation} failed with exit code ${result.exitCode} for "${target.localPath}" → "${target.dest}"${detail}`,
      );
    }
  }

  async #execWithRetry(target: UploadTarget, operation: string, script: string, stdin: Buffer): Promise<RemoteResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.#execOnce(target, script, stdin);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (!this.#isRetryable(error) || attempt >= OpenshellSdkFileTransfer.MAX_RETRIES) {
          throw error;
        }
        const backoff = OpenshellSdkFileTransfer.INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        console.warn(
          `[openshell-file-transfer] ${operation} attempt ${attempt} failed for "${target.sandboxName}:${target.dest}", retrying in ${backoff}ms:`,
          error.message,
        );
        await new Promise<void>(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  async #execOnce(target: UploadTarget, script: string, stdin: Buffer): Promise<RemoteResult> {
    const session = await target.client.sandbox.execInteractive(target.sandboxName, ['sh', '-c', script], {
      tty: false,
      noLoginShell: true,
    });

    // Drain output concurrently so the bounded output queue never stalls the stream.
    const stderrChunks: Buffer[] = [];
    const draining = (async (): Promise<void> => {
      for await (const event of session.output) {
        if ('stream' in event && event.stream === 'stderr') {
          stderrChunks.push(event.data);
        }
      }
    })();

    try {
      for (let offset = 0; offset < stdin.length; offset += OpenshellSdkFileTransfer.STDIN_CHUNK_BYTES) {
        session.write(stdin.subarray(offset, offset + OpenshellSdkFileTransfer.STDIN_CHUNK_BYTES));
      }
    } catch (err: unknown) {
      // The remote command exited before consuming stdin (e.g. mkdir failed);
      // its exit status and stderr carry the actual reason.
      console.warn(`[openshell-file-transfer] stdin closed early for "${target.sandboxName}:${target.dest}":`, err);
    } finally {
      session.closeInput();
    }

    const [exitCode] = await Promise.all([session.done, draining]);
    return { exitCode, stderr: Buffer.concat(stderrChunks).toString().trim() };
  }

  /**
   * Returns the files `git ls-files -co --exclude-standard` reports for `dir`
   * (relative to it), or `undefined` when `dir` is not in a Git work tree or
   * Git is unavailable, in which case everything is uploaded (CLI behavior).
   */
  async #listGitFiles(dir: string): Promise<string[] | undefined> {
    try {
      const result = await this.exec.exec('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard', '-z'], {
        // Git translates its messages; the "not a git repository" check below relies on the English text.
        env: { LC_ALL: 'C' },
      });
      return result.stdout.split('\0').filter(path => path.length > 0);
    } catch (err: unknown) {
      const stderr = err instanceof Error && 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : '';
      const message = err instanceof Error ? err.message : String(err);
      if (stderr.includes('not a git repository') || message.includes('ENOENT')) {
        console.warn(
          `[openshell-file-transfer] "${dir}" is outside a Git work tree or Git is unavailable; uploading without .gitignore filtering`,
        );
        return undefined;
      }
      throw new Error(`Git filtering failed for "${dir}": ${stderr || message}`);
    }
  }

  /** Git-listed files that exist on disk; files tracked by Git but deleted from the work tree are skipped. */
  async #listUploadableGitFiles(dir: string): Promise<string[] | undefined> {
    const files = await this.#listGitFiles(dir);
    if (!files) {
      return undefined;
    }
    const existing: string[] = [];
    for (const file of files) {
      try {
        await lstat(join(dir, file));
        existing.push(file);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          console.warn(`[openshell-file-transfer] skipping "${join(dir, file)}": listed by Git but missing on disk`);
          continue;
        }
        throw err;
      }
    }
    return existing;
  }

  /**
   * Like `cp -r` and the CLI, a directory is extracted as `<dest>/<basename>/...`.
   * Paths without a meaningful basename (such as the filesystem root) have no
   * prefix, so their contents are extracted directly into `<dest>`.
   */
  #directoryPrefix(dirPath: string): string {
    const name = basename(dirPath);
    return name === '.' || name === '..' ? '' : name;
  }

  /**
   * Quotes a sandbox path for `sh`. A leading `~` or `~/` is expanded to the
   * sandbox user's home through `$HOME` (a quoted `~` is not expanded by the
   * shell and would create a literal `~` directory); the rest is escaped.
   */
  #remotePath(path: string): string {
    if (path === '~') {
      return '"$HOME"';
    }
    if (path.startsWith('~/')) {
      return `"$HOME"/${this.#shellEscape(path.slice(2))}`;
    }
    return this.#shellEscape(path);
  }

  #shellEscape(value: string): string {
    const escapedQuote = `'\\''`;
    return `'${value.replace(/'/g, escapedQuote)}'`;
  }

  /** Retries only when the gateway or the connection to it is unavailable, as the SDK does for log watching. */
  #isRetryable(err: Error): boolean {
    return err instanceof SdkError && err.connectCode === OpenshellSdkFileTransfer.GRPC_UNAVAILABLE;
  }
}
