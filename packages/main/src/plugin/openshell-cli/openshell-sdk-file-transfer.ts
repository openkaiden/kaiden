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
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import type { Writable } from 'node:stream';

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { inject, injectable } from 'inversify';
import type { Headers, Pack } from 'tar-stream';
import { pack } from 'tar-stream';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { Exec } from '/@/plugin/util/exec.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const SMALL_FILE_THRESHOLD = 1024 * 1024;
const STDIN_CHUNK_BYTES = 64 * 1024;
/**
 * Archive bytes sent per exec. Exec stdin has no flow control: the sandbox
 * supervisor kills the command (exit 74, "process stdin buffer is full") once
 * more than 4 MiB is waiting for the process to read it. Keeping every exec's
 * stdin well below that budget makes overflow impossible.
 */
const UPLOAD_PART_BYTES = 2 * 1024 * 1024;
const REMOTE_STAGING_ROOT = '/tmp';

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
 * The archive is produced as a stream (with backpressure) and sent as stdin
 * of remote commands through the SDK's `execInteractive` with `tty: false`:
 * - archives up to {@link UPLOAD_PART_BYTES} are extracted by a single
 *   `tar xf -` exec;
 * - larger archives are staged as part files in the sandbox, one short exec
 *   per part, then concatenated into `tar xf -` and removed.
 *
 * Like the CLI, directories inside a Git work tree only include the files
 * reported by `git ls-files -co --exclude-standard` (i.e. `.gitignore` rules
 * apply).
 */
@injectable()
export class OpenshellSdkFileTransfer {
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

    const gitFiles = stat.isDirectory() ? await this.#listGitFiles(localPath) : undefined;
    if (gitFiles?.length === 0) {
      throw new Error(
        `Git filtering selected no files for "${localPath}": the directory is empty or all its files are ignored`,
      );
    }

    const client = await this.sdkClientManager.getClient(gatewayName);
    const target: UploadTarget = { client, sandboxName, localPath, dest };

    const archive = pack();
    const producing = (async (): Promise<void> => {
      try {
        await this.#writeArchive(archive, localPath, stat, archiveName, gitFiles);
        archive.finalize();
      } catch (err: unknown) {
        archive.destroy(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    })();
    const sending = (async (): Promise<void> => {
      try {
        await this.#sendArchive(target, archive, extractDir);
      } catch (err: unknown) {
        // Stop the producer: nothing will read the rest of the archive.
        archive.destroy();
        throw err;
      }
    })();

    // A producer failure destroys the archive, which also fails the sender
    // with the producer's error, so the sender's outcome is reported first.
    const [sent, produced] = await Promise.allSettled([sending, producing]);
    if (sent.status === 'rejected') {
      throw sent.reason;
    }
    if (produced.status === 'rejected') {
      throw produced.reason;
    }
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

    const stagingDir = this.#shellEscape(`${REMOTE_STAGING_ROOT}/kaiden-upload-${randomUUID()}`);
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

  /** Splits the archive stream into buffers of {@link UPLOAD_PART_BYTES} (the last one may be shorter). */
  async *#readParts(archive: Pack): AsyncGenerator<Buffer, void, void> {
    let buffered: Buffer[] = [];
    let size = 0;
    for await (const chunk of archive) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      buffered.push(data);
      size += data.length;
      while (size >= UPLOAD_PART_BYTES) {
        const all = Buffer.concat(buffered, size);
        yield all.subarray(0, UPLOAD_PART_BYTES);
        const rest = all.subarray(UPLOAD_PART_BYTES);
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
        if (!this.#isRetryable(error) || attempt >= MAX_RETRIES) {
          throw error;
        }
        const backoff = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
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
      for (let offset = 0; offset < stdin.length; offset += STDIN_CHUNK_BYTES) {
        session.write(stdin.subarray(offset, offset + STDIN_CHUNK_BYTES));
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
      const result = await this.exec.exec('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard', '-z']);
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

  async #writeArchive(
    archive: Pack,
    localPath: string,
    stat: Stats,
    archiveName: string | undefined,
    gitFiles: string[] | undefined,
  ): Promise<void> {
    if (stat.isDirectory()) {
      if (gitFiles) {
        await this.#addFileListToArchive(archive, localPath, gitFiles);
      } else {
        await this.#addDirectoryToArchive(archive, localPath, '');
      }
    } else if (stat.isSymbolicLink()) {
      const linkTarget = await readlink(localPath);
      await this.#addEntry(archive, {
        name: archiveName ?? basename(localPath),
        type: 'symlink',
        linkname: linkTarget,
      });
    } else {
      await this.#addFileToArchive(archive, localPath, archiveName ?? basename(localPath), stat);
    }
  }

  async #addFileListToArchive(archive: Pack, root: string, files: string[]): Promise<void> {
    for (const relativePath of files) {
      const fullPath = join(root, relativePath);
      let entryStat: Stats;
      try {
        entryStat = await lstat(fullPath);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
          // Tracked by Git but deleted from the work tree.
          console.warn(`[openshell-file-transfer] skipping "${fullPath}": listed by Git but missing on disk`);
          continue;
        }
        throw err;
      }

      if (entryStat.isSymbolicLink()) {
        const linkTarget = await readlink(fullPath);
        await this.#addEntry(archive, { name: relativePath, type: 'symlink', linkname: linkTarget });
      } else if (entryStat.isDirectory()) {
        // Git lists a submodule as a single path.
        await this.#addEntry(archive, { name: `${relativePath}/`, type: 'directory' });
        await this.#addDirectoryToArchive(archive, fullPath, relativePath);
      } else if (entryStat.isFile()) {
        await this.#addFileToArchive(archive, fullPath, relativePath, entryStat);
      }
    }
  }

  async #addDirectoryToArchive(archive: Pack, dirPath: string, prefix: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isSymbolicLink()) {
        const linkTarget = await readlink(fullPath);
        await this.#addEntry(archive, { name: archivePath, type: 'symlink', linkname: linkTarget });
      } else if (entry.isDirectory()) {
        await this.#addEntry(archive, { name: `${archivePath}/`, type: 'directory' });
        await this.#addDirectoryToArchive(archive, fullPath, archivePath);
      } else if (entry.isFile()) {
        const fileStat = await lstat(fullPath);
        await this.#addFileToArchive(archive, fullPath, archivePath, fileStat);
      }
    }
  }

  async #addFileToArchive(archive: Pack, filePath: string, archivePath: string, stat: Stats): Promise<void> {
    if (stat.size <= SMALL_FILE_THRESHOLD) {
      const content = await readFile(filePath);
      await this.#addEntry(
        archive,
        { name: archivePath, size: content.length, mode: stat.mode, mtime: stat.mtime, type: 'file' },
        content,
      );
      return;
    }

    // Stream large files, honoring the archive's backpressure.
    let entry: Writable | undefined;
    const packed = new Promise<void>((resolve, reject) => {
      entry = archive.entry(
        { name: archivePath, size: stat.size, mode: stat.mode, mtime: stat.mtime, type: 'file' },
        err => (err ? reject(err) : resolve()),
      );
    });
    if (!entry) {
      throw new Error(`failed to create archive entry for "${filePath}"`);
    }
    try {
      for await (const chunk of createReadStream(filePath)) {
        if (!entry.write(chunk)) {
          await this.#waitForDrain(entry);
        }
      }
      entry.end();
    } catch (err: unknown) {
      entry.destroy(err instanceof Error ? err : new Error(String(err)));
      await packed.catch((packError: unknown) => {
        console.debug(`[openshell-file-transfer] archive entry "${archivePath}" aborted:`, packError);
      });
      throw err;
    }
    await packed;
  }

  /** Adds an entry and resolves once the archive reader has consumed it. */
  #addEntry(archive: Pack, header: Headers, content?: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const done = (err?: Error | null): void => (err ? reject(err) : resolve());
      if (content) {
        archive.entry(header, content, done);
      } else {
        archive.entry(header, done);
      }
    });
  }

  #waitForDrain(entry: Writable): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onDrain = (): void => {
        entry.off('close', onClose);
        resolve();
      };
      const onClose = (): void => {
        entry.off('drain', onDrain);
        reject(new Error('archive entry closed before it was fully written'));
      };
      entry.once('drain', onDrain);
      entry.once('close', onClose);
    });
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

  #isRetryable(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('connect') || msg.includes('unavailable') || msg.includes('deadline') || msg.includes('rst_stream')
    );
  }
}
