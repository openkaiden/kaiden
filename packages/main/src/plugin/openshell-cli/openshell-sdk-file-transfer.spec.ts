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

import type { Stats } from 'node:fs';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { ExecInteractiveSessionControl, ExecStreamEvent, OpenShellClient } from '@nvidia/openshell-sdk';
import { extract } from 'tar-stream';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { Exec } from '/@/plugin/util/exec.js';

import { OpenshellSdkFileTransfer } from './openshell-sdk-file-transfer.js';

vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));
vi.mock(import('/@/plugin/util/exec.js'));

const FILE_CONTENT = Buffer.from('file-content');
const PART_BYTES = 2 * 1024 * 1024;
const STAGING_DIR = /^'\/tmp\/kaiden-upload-[0-9a-f-]{36}'$/;

let transfer: OpenshellSdkFileTransfer;
let sdkClientManager: OpenshellSdkClientManager;
let exec: Exec;
let execInteractive: OpenShellClient['sandbox']['execInteractive'];
let sessions: ExecInteractiveSessionControl[];
let sessionOptions: (script: string) => SessionOptions;

interface SessionOptions {
  exitCode?: number;
  stderr?: string;
  outputError?: Error;
}

function createSession(options: SessionOptions): ExecInteractiveSessionControl {
  const exitCode = options.exitCode ?? 0;
  async function* output(): AsyncGenerator<ExecStreamEvent, void, void> {
    if (options.outputError) {
      throw options.outputError;
    }
    yield { stream: 'stdout', data: Buffer.from('ignored') };
    if (options.stderr) {
      yield { stream: 'stderr', data: Buffer.from(options.stderr) };
    }
    yield { type: 'exit', exitCode };
  }
  return {
    output: output(),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(),
    closeInput: vi.fn(),
    cancel: vi.fn(),
    exitCode,
    done: options.outputError ? Promise.reject(options.outputError) : Promise.resolve(exitCode),
  };
}

function scripts(): string[] {
  return vi.mocked(execInteractive).mock.calls.map(([, command]) => {
    expect(command.slice(0, 2)).toEqual(['sh', '-c']);
    const script = command[2];
    assert(script);
    return script;
  });
}

function stdinOf(session: ExecInteractiveSessionControl | undefined): Buffer {
  assert(session);
  return Buffer.concat(vi.mocked(session.write).mock.calls.map(([data]) => data));
}

interface ArchiveEntry {
  name: string;
  type: string | null | undefined;
  linkname: string | null | undefined;
  content: string;
}

async function readArchive(data: Buffer): Promise<ArchiveEntry[]> {
  const extractor = extract();
  const entries: ArchiveEntry[] = [];
  const reading = (async (): Promise<void> => {
    for await (const entry of extractor) {
      const parts: Buffer[] = [];
      for await (const chunk of entry) {
        parts.push(chunk);
      }
      entries.push({
        name: entry.header.name,
        type: entry.header.type,
        linkname: entry.header.linkname,
        content: Buffer.concat(parts).toString(),
      });
    }
  })();
  extractor.end(data);
  await reading;
  return entries;
}

function mockFileStat(size = FILE_CONTENT.length): Stats {
  return {
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    size,
    mode: 0o644,
    mtime: new Date('2026-01-01'),
  } as unknown as Stats;
}

function mockDirStat(): Stats {
  return {
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  } as unknown as Stats;
}

function mockSymlinkStat(): Stats {
  return {
    isDirectory: () => false,
    isFile: () => false,
    isSymbolicLink: () => true,
  } as unknown as Stats;
}

interface MockDirent {
  name: string;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}

function dirent(name: string, kind: 'file' | 'dir' | 'symlink'): MockDirent {
  return {
    name,
    isFile: (): boolean => kind === 'file',
    isDirectory: (): boolean => kind === 'dir',
    isSymbolicLink: (): boolean => kind === 'symlink',
  };
}

/** Paths built by the code under test use the platform separator; the mocks key on POSIX-style paths. */
function asPosix(path: unknown): string {
  return String(path).replaceAll('\\', '/');
}

function gitError(stderr: string, message = 'Command execution failed with exit code 128'): Error {
  return Object.assign(new Error(message), { stderr });
}

function mockProjectTree(): void {
  vi.mocked(lstat).mockImplementation(async (path: Parameters<typeof lstat>[0]) => {
    const p = asPosix(path);
    if (p === '/local/project' || p === '/local/project/sub') {
      return mockDirStat();
    }
    return mockFileStat();
  });
  vi.mocked(readdir).mockImplementation(async (path: Parameters<typeof readdir>[0]) => {
    const p = asPosix(path);
    if (p === '/local/project') {
      return [dirent('readme.md', 'file'), dirent('sub', 'dir')] as never;
    }
    if (p === '/local/project/sub') {
      return [dirent('nested.ts', 'file')] as never;
    }
    return [] as never;
  });
}

function mockLargeFile(size: number): Buffer {
  const content = Buffer.alloc(size, 'y');
  vi.mocked(lstat).mockResolvedValue(mockFileStat(size));
  vi.mocked(createReadStream).mockReturnValue(Readable.from(content) as never);
  return content;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessions = [];
  sessionOptions = (): SessionOptions => ({});
  execInteractive = vi
    .fn<OpenShellClient['sandbox']['execInteractive']>()
    .mockImplementation(async (_name, command) => {
      const session = createSession(sessionOptions(command[2] ?? ''));
      sessions.push(session);
      return session;
    });
  sdkClientManager = new OpenshellSdkClientManager(undefined!, undefined!);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue({
    sandbox: { execInteractive },
  } as unknown as OpenShellClient);
  exec = new Exec(undefined!);
  vi.mocked(exec.exec).mockRejectedValue(
    gitError('fatal: not a git repository (or any of the parent directories): .git'),
  );

  vi.mocked(lstat).mockResolvedValue(mockFileStat());
  vi.mocked(readFile).mockResolvedValue(FILE_CONTENT);
  vi.mocked(createReadStream).mockReturnValue(Readable.from(FILE_CONTENT) as never);

  transfer = new OpenshellSdkFileTransfer(sdkClientManager, exec);
});

describe('single exec uploads', () => {
  test('runs tar extraction through execInteractive without a TTY or login shell', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');

    expect(execInteractive).toHaveBeenCalledOnce();
    expect(execInteractive).toHaveBeenCalledWith('my-sandbox', ['sh', '-c', expect.any(String)], {
      tty: false,
      noLoginShell: true,
    });
    expect(scripts()).toEqual([`mkdir -p -- '/remote' && tar xf - -C '/remote'`]);
  });

  test('streams a valid tar archive with the file content as stdin, then closes stdin', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');

    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries).toEqual([{ name: 'file.txt', type: 'file', linkname: null, content: 'file-content' }]);

    const session = sessions[0];
    assert(session);
    const lastWrite = vi.mocked(session.write).mock.invocationCallOrder.at(-1);
    const closeInput = vi.mocked(session.closeInput).mock.invocationCallOrder[0];
    assert(lastWrite !== undefined && closeInput !== undefined);
    expect(lastWrite).toBeLessThan(closeInput);
  });

  test('renames archive entry to dest basename for scp-style paths', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/dir/renamed.txt');

    expect(scripts()).toEqual([`mkdir -p -- '/remote/dir' && tar xf - -C '/remote/dir'`]);
    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => entry.name)).toEqual(['renamed.txt']);
  });

  test('uses dest as extract directory and keeps the local name when dest ends with slash', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/dir/');

    expect(scripts()).toEqual([`mkdir -p -- '/remote/dir/' && tar xf - -C '/remote/dir/'`]);
    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => entry.name)).toEqual(['file.txt']);
  });

  test('shell-escapes single quotes in destination path', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', `/remote/it's here/file.txt`);

    expect(scripts()[0]).toContain(`tar xf - -C '/remote/it'\\''s here'`);
  });

  test('does not consult git for single file uploads', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');

    expect(exec.exec).not.toHaveBeenCalled();
  });

  test('preserves a single symlink upload under the dest basename', async () => {
    vi.mocked(lstat).mockResolvedValue(mockSymlinkStat());
    vi.mocked(readlink).mockResolvedValue('/target/path');

    await transfer.uploadToSandbox('my-sandbox', '/local/link', '/remote/renamed-link');

    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries).toEqual([{ name: 'renamed-link', type: 'symlink', linkname: '/target/path', content: '' }]);
  });

  test('passes gateway name to getClient', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt', 'my-gateway');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('my-gateway');
  });
});

describe('directory uploads', () => {
  test('archives every entry when the directory is outside a git work tree', async () => {
    mockProjectTree();

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    expect(exec.exec).toHaveBeenCalledWith('git', [
      '-C',
      '/local/project',
      'ls-files',
      '-co',
      '--exclude-standard',
      '-z',
    ]);
    expect(scripts()).toEqual([`mkdir -p -- '/sandbox/project' && tar xf - -C '/sandbox/project'`]);
    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => [entry.name, entry.type])).toEqual([
      ['readme.md', 'file'],
      ['sub/', 'directory'],
      ['sub/nested.ts', 'file'],
    ]);
  });

  test('archives every entry when git is not installed', async () => {
    mockProjectTree();
    vi.mocked(exec.exec).mockRejectedValue(gitError('', 'Failed to execute command: spawn git ENOENT'));

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => entry.name)).toEqual(['readme.md', 'sub/', 'sub/nested.ts']);
  });

  test('only archives files git reports when the directory is in a git work tree', async () => {
    mockProjectTree();
    vi.mocked(exec.exec).mockResolvedValue({ command: 'git', stdout: 'readme.md\0sub/nested.ts\0', stderr: '' });

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    expect(readdir).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith(join('/local/project', 'readme.md'));
    expect(readFile).toHaveBeenCalledWith(join('/local/project', 'sub/nested.ts'));
    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => [entry.name, entry.content])).toEqual([
      ['readme.md', 'file-content'],
      ['sub/nested.ts', 'file-content'],
    ]);
  });

  test('skips files git tracks that are missing on disk', async () => {
    vi.mocked(exec.exec).mockResolvedValue({ command: 'git', stdout: 'gone.txt\0kept.txt\0', stderr: '' });
    vi.mocked(lstat).mockImplementation(async (path: Parameters<typeof lstat>[0]) => {
      const p = asPosix(path);
      if (p === '/local/project') {
        return mockDirStat();
      }
      if (p === '/local/project/gone.txt') {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      }
      return mockFileStat();
    });

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => entry.name)).toEqual(['kept.txt']);
  });

  test('refuses to upload when git filtering selects no files', async () => {
    vi.mocked(lstat).mockResolvedValue(mockDirStat());
    vi.mocked(exec.exec).mockResolvedValue({ command: 'git', stdout: '', stderr: '' });

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project')).rejects.toThrow(
      'Git filtering selected no files for "/local/project"',
    );
    expect(execInteractive).not.toHaveBeenCalled();
  });

  test('fails when git reports an unexpected error', async () => {
    vi.mocked(lstat).mockResolvedValue(mockDirStat());
    vi.mocked(exec.exec).mockRejectedValue(gitError('fatal: bad object HEAD'));

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project')).rejects.toThrow(
      'Git filtering failed for "/local/project": fatal: bad object HEAD',
    );
    expect(execInteractive).not.toHaveBeenCalled();
  });

  test('preserves symlink entries in directories', async () => {
    vi.mocked(lstat).mockResolvedValue(mockDirStat());
    vi.mocked(readdir).mockResolvedValue([dirent('link.txt', 'symlink')] as never);
    vi.mocked(readlink).mockResolvedValue('../target.txt');

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/remote/dest');

    expect(readlink).toHaveBeenCalledWith(join('/local/project', 'link.txt'));
    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries).toEqual([{ name: 'link.txt', type: 'symlink', linkname: '../target.txt', content: '' }]);
  });
});

describe('staged uploads of archives larger than one part', () => {
  test('stages parts of at most 2 MiB, extracts them in order, then removes the staging directory', async () => {
    const content = mockLargeFile(5 * 1024 * 1024);

    await transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin');

    expect(createReadStream).toHaveBeenCalledWith('/local/huge.bin');
    const all = scripts();
    expect(all).toHaveLength(5);

    const stagingDir = /^mkdir -p -- ('[^']+') && cat > '[^']+'\/part-000000$/.exec(all[0] ?? '')?.[1];
    assert(stagingDir);
    expect(stagingDir).toMatch(STAGING_DIR);
    expect(all).toEqual([
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/part-000000`,
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/part-000001`,
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/part-000002`,
      `mkdir -p -- '/remote' && cat ${stagingDir}/part-* | tar xf - -C '/remote'`,
      `rm -rf -- ${stagingDir}`,
    ]);

    const parts = sessions.slice(0, 3).map(session => stdinOf(session));
    expect(parts.map(part => part.length)).toEqual([PART_BYTES, PART_BYTES, content.length + 1536 - 2 * PART_BYTES]);
    expect(stdinOf(sessions[3])).toHaveLength(0);
    const entries = await readArchive(Buffer.concat(parts));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('huge.bin');
    expect(entries[0]?.content).toBe(content.toString());
  });

  test('writes stdin in chunks of at most 64 KiB', async () => {
    mockLargeFile(3 * 1024 * 1024);

    await transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin');

    const chunkSizes = sessions.flatMap(session => vi.mocked(session.write).mock.calls.map(([data]) => data.length));
    expect(Math.max(...chunkSizes)).toBe(64 * 1024);
  });

  test('removes the staging directory and reports the failure when a part cannot be staged', async () => {
    mockLargeFile(5 * 1024 * 1024);
    sessionOptions = (script): SessionOptions =>
      script.endsWith('part-000001') ? { exitCode: 1, stderr: 'cat: write error: No space left on device' } : {};

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin')).rejects.toThrow(
      'upload staging failed with exit code 1 for "/local/huge.bin" → "/remote/huge.bin" (cat: write error: No space left on device)',
    );

    const all = scripts();
    expect(all).toHaveLength(3);
    expect(all.at(-1)).toMatch(/^rm -rf -- '\/tmp\/kaiden-upload-[0-9a-f-]{36}'$/);
  });

  test('still reports the upload result when removing the staging directory fails', async () => {
    mockLargeFile(3 * 1024 * 1024);
    sessionOptions = (script): SessionOptions => (script.startsWith('rm -rf') ? { exitCode: 1 } : {});

    await transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin');

    expect(scripts().at(-1)).toMatch(/^rm -rf -- /);
  });
});

describe('errors and retries', () => {
  test('throws on non-zero exit code with stderr detail', async () => {
    sessionOptions = (): SessionOptions => ({ exitCode: 2, stderr: 'tar: This does not look like a tar archive\n' });

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt')).rejects.toThrow(
      'tar extraction failed with exit code 2 for "/local/file.txt" → "/remote/file.txt" (tar: This does not look like a tar archive)',
    );
  });

  test('reports the remote failure when the command exits before stdin is consumed', async () => {
    sessionOptions = (): SessionOptions => ({ exitCode: 1, stderr: 'mkdir: cannot create directory' });
    vi.mocked(execInteractive).mockImplementationOnce(async () => {
      const session = createSession(sessionOptions(''));
      vi.mocked(session.write).mockImplementation(() => {
        throw new Error('exec input is closed');
      });
      sessions.push(session);
      return session;
    });

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt')).rejects.toThrow(
      /exit code 1.*mkdir: cannot create directory/,
    );
    expect(sessions[0]?.closeInput).toHaveBeenCalled();
  });

  test('propagates output stream failures without retrying', async () => {
    sessionOptions = (): SessionOptions => ({ outputError: new Error('stream reset') });

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt')).rejects.toThrow(
      'stream reset',
    );
    expect(execInteractive).toHaveBeenCalledOnce();
  });

  test('retries an exec on transient connection errors', async () => {
    vi.mocked(execInteractive).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');

    expect(execInteractive).toHaveBeenCalledTimes(2);
    const entries = await readArchive(stdinOf(sessions[0]));
    expect(entries.map(entry => entry.name)).toEqual(['file.txt']);
  });

  test('does not retry on non-transient errors', async () => {
    vi.mocked(execInteractive).mockRejectedValue(new Error('sandbox not found'));

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt')).rejects.toThrow(
      'sandbox not found',
    );
    expect(execInteractive).toHaveBeenCalledOnce();
  });

  test('throws after max retries on persistent transient errors', async () => {
    vi.mocked(execInteractive).mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt')).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    expect(execInteractive).toHaveBeenCalledTimes(3);
  });

  test('throws on archive build error without starting a remote command', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/missing', '/remote/dest')).rejects.toThrow('ENOENT');
    expect(execInteractive).not.toHaveBeenCalled();
  });

  test('stops producing the archive when a staged upload fails', async () => {
    mockLargeFile(9 * 1024 * 1024);
    sessionOptions = (script): SessionOptions => (script.endsWith('part-000000') ? { exitCode: 1 } : {});

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin')).rejects.toThrow(
      'upload staging failed with exit code 1',
    );
    // Only the failed part and the cleanup ran; the rest of the archive was never sent.
    expect(scripts()).toHaveLength(2);
  });
});
