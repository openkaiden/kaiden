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
import { lstat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import type { ExecInteractiveSessionControl, ExecStreamEvent, OpenShellClient } from '@nvidia/openshell-sdk';
import { SdkError } from '@nvidia/openshell-sdk';
import type { PackOptions } from 'tar-fs';
import tar from 'tar-fs';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { Exec } from '/@/plugin/util/exec.js';

import { OpenshellSdkFileTransfer } from './openshell-sdk-file-transfer.js';

vi.mock(import('node:fs/promises'));
vi.mock(import('tar-fs'));
vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));
vi.mock(import('/@/plugin/util/exec.js'));

/** Exposes the protected constants of the class under test, so the spec reads the real values. */
class TestOpenshellSdkFileTransfer extends OpenshellSdkFileTransfer {
  static readonly maxRetries = OpenshellSdkFileTransfer.MAX_RETRIES;
  static readonly partBytes = OpenshellSdkFileTransfer.UPLOAD_PART_BYTES;
  static readonly stdinChunkBytes = OpenshellSdkFileTransfer.STDIN_CHUNK_BYTES;
  static readonly stagingRoot = OpenshellSdkFileTransfer.REMOTE_STAGING_ROOT;
  static readonly unavailable = OpenshellSdkFileTransfer.GRPC_UNAVAILABLE;
}

const { maxRetries, partBytes, stdinChunkBytes, stagingRoot, unavailable } = TestOpenshellSdkFileTransfer;

const ARCHIVE = Buffer.from('tar-archive-bytes');

let transfer: OpenshellSdkFileTransfer;
let sdkClientManager: OpenshellSdkClientManager;
let exec: Exec;
let execInteractive: OpenShellClient['sandbox']['execInteractive'];
let sessions: ExecInteractiveSessionControl[];
let sessionOptions: (script: string) => SessionOptions;
let archives: Readable[];

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

function stagingDirOf(script: string | undefined): string {
  const stagingDir = /^mkdir -p -- ('[^']+') && cat > /.exec(script ?? '')?.[1];
  assert(stagingDir);
  return stagingDir;
}

function unavailableError(): SdkError {
  return new SdkError('rpc', 'connect ECONNREFUSED', { connectCode: unavailable });
}

function stdinOf(session: ExecInteractiveSessionControl | undefined): Buffer {
  assert(session);
  return Buffer.concat(vi.mocked(session.write).mock.calls.map(([data]) => data));
}

/** Makes every `tar.pack` call return a fresh stream of `data`, standing in for the archive tar-fs builds. */
function mockArchive(data: Buffer): Buffer {
  vi.mocked(tar.pack).mockImplementation(() => {
    const archive = Readable.from([data]);
    archives.push(archive);
    return archive as never;
  });
  return data;
}

function packCall(): { cwd: string; options: PackOptions } {
  const call = vi.mocked(tar.pack).mock.calls[0];
  assert(call);
  const [cwd, options] = call;
  assert(options);
  return { cwd, options };
}

/** The name the archive gets for a local entry called `original`, after the `map` passed to tar-fs. */
function archivedName(options: PackOptions, original: string): string {
  assert(options.map);
  return options.map({ name: original, mode: 0o644, mtime: new Date(0), size: 1, type: 'file', uid: 0, gid: 0 }).name;
}

function mockFileStat(): Stats {
  return {
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
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

/** Paths built by the code under test use the platform separator; the mocks key on POSIX-style paths. */
function asPosix(path: unknown): string {
  return String(path).replaceAll('\\', '/');
}

/** `root` is a directory; every other path is a regular file. */
function mockDirectoryRoot(root: string): void {
  vi.mocked(lstat).mockImplementation(async (path: Parameters<typeof lstat>[0]) =>
    asPosix(path) === root ? mockDirStat() : mockFileStat(),
  );
}

function gitError(stderr: string, message = 'Command execution failed with exit code 128'): Error {
  return Object.assign(new Error(message), { stderr });
}

function gitListing(...files: string[]): void {
  vi.mocked(exec.exec).mockResolvedValue({
    command: 'git',
    stdout: files.map(file => `${file}\0`).join(''),
    stderr: '',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  sessions = [];
  archives = [];
  sessionOptions = (): SessionOptions => ({});
  execInteractive = vi
    .fn<OpenShellClient['sandbox']['execInteractive']>()
    .mockImplementation(async (_name, command) => {
      const session = createSession(sessionOptions(command[2] ?? ''));
      sessions.push(session);
      return session;
    });
  sdkClientManager = Object.create(OpenshellSdkClientManager.prototype);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue({
    sandbox: { execInteractive },
  } as unknown as OpenShellClient);
  exec = Object.create(Exec.prototype);
  vi.mocked(exec.exec).mockRejectedValue(
    gitError('fatal: not a git repository (or any of the parent directories): .git'),
  );

  vi.mocked(lstat).mockResolvedValue(mockFileStat());
  mockArchive(ARCHIVE);

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

  test('streams the archive as stdin, then closes stdin', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');

    expect(stdinOf(sessions[0])).toEqual(ARCHIVE);
    const session = sessions[0];
    assert(session);
    const lastWrite = vi.mocked(session.write).mock.invocationCallOrder.at(-1);
    const closeInput = vi.mocked(session.closeInput).mock.invocationCallOrder[0];
    assert(lastWrite !== undefined && closeInput !== undefined);
    expect(lastWrite).toBeLessThan(closeInput);
  });

  test('archives a single file from its parent directory, keeping its name when dest ends with slash', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/dir/');

    const { cwd, options } = packCall();
    expect(cwd).toBe('/local');
    expect(options).toEqual({ entries: ['file.txt'], strict: false, map: expect.any(Function) });
    expect(archivedName(options, 'file.txt')).toBe('file.txt');
    expect(scripts()).toEqual([`mkdir -p -- '/remote/dir/' && tar xf - -C '/remote/dir/'`]);
  });

  test('renames a single file to the dest basename for scp-style paths', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/dir/renamed.txt');

    expect(archivedName(packCall().options, 'file.txt')).toBe('renamed.txt');
    expect(scripts()).toEqual([`mkdir -p -- '/remote/dir' && tar xf - -C '/remote/dir'`]);
  });

  test('renames a single symlink to the dest basename', async () => {
    vi.mocked(lstat).mockResolvedValue(mockSymlinkStat());

    await transfer.uploadToSandbox('my-sandbox', '/local/link', '/remote/renamed-link');

    const { cwd, options } = packCall();
    expect(cwd).toBe('/local');
    expect(options.entries).toEqual(['link']);
    expect(archivedName(options, 'link')).toBe('renamed-link');
  });

  test('shell-escapes single quotes in destination path', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', `/remote/it's here/file.txt`);

    expect(scripts()[0]).toContain(`tar xf - -C '/remote/it'\\''s here'`);
  });

  test('does not consult git for single file uploads', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');

    expect(exec.exec).not.toHaveBeenCalled();
  });

  test('passes gateway name to getClient', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt', 'my-gateway');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('my-gateway');
  });
});

describe('home directory destinations', () => {
  test.each([
    { dest: '~', extractDir: `"$HOME"` },
    { dest: '~/', extractDir: `"$HOME"/''` },
    { dest: '~/.config/app', extractDir: `"$HOME"/'.config/app'` },
    { dest: `~/it's here`, extractDir: `"$HOME"/'it'\\''s here'` },
  ])('expands a leading ~ for directory dest "$dest"', async ({ dest, extractDir }) => {
    vi.mocked(lstat).mockResolvedValue(mockDirStat());

    await transfer.uploadToSandbox('my-sandbox', '/local/project', dest);

    expect(scripts()).toEqual([`mkdir -p -- ${extractDir} && tar xf - -C ${extractDir}`]);
  });

  test('extracts a file uploaded to ~/name into $HOME under that name', async () => {
    await transfer.uploadToSandbox('my-sandbox', '/local/gitconfig', '~/.gitconfig');

    expect(scripts()).toEqual([`mkdir -p -- "$HOME" && tar xf - -C "$HOME"`]);
    expect(archivedName(packCall().options, 'gitconfig')).toBe('.gitconfig');
  });

  test.each([
    '/remote/~backup',
    '~other/dir',
    'dir/~/sub',
    '.config/~',
  ])('does not expand a ~ that is not a leading ~ or ~/ in "%s"', async dest => {
    vi.mocked(lstat).mockResolvedValue(mockDirStat());

    await transfer.uploadToSandbox('my-sandbox', '/local/project', dest);

    expect(scripts()).toEqual([`mkdir -p -- '${dest}' && tar xf - -C '${dest}'`]);
  });

  test('extracts staged uploads into the expanded home directory', async () => {
    mockArchive(Buffer.alloc(1.5 * partBytes, 'y'));

    await transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '~/data/');

    const all = scripts();
    expect(all.at(-2)).toBe(
      `mkdir -p -- "$HOME"/'data/' && cat ${stagingDirOf(all[0])}/part-* | tar xf - -C "$HOME"/'data/'`,
    );
  });
});

describe('directory uploads', () => {
  test('wraps the whole directory under its basename when it is outside a git work tree', async () => {
    mockDirectoryRoot('/local/project');

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    expect(exec.exec).toHaveBeenCalledWith(
      'git',
      ['-C', '/local/project', 'ls-files', '-co', '--exclude-standard', '-z'],
      { env: { LC_ALL: 'C' } },
    );
    expect(tar.pack).toHaveBeenCalledWith('/local', { entries: ['project'], strict: false });
    expect(scripts()).toEqual([`mkdir -p -- '/sandbox/project' && tar xf - -C '/sandbox/project'`]);
  });

  test('wraps the whole directory when git is not installed', async () => {
    mockDirectoryRoot('/local/project');
    vi.mocked(exec.exec).mockRejectedValue(gitError('', 'Failed to execute command: spawn git ENOENT'));

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    expect(tar.pack).toHaveBeenCalledWith('/local', { entries: ['project'], strict: false });
  });

  test('only archives the files git reports, under the directory basename', async () => {
    mockDirectoryRoot('/local/project');
    gitListing('readme.md', 'sub/nested.ts');

    await transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project');

    expect(tar.pack).toHaveBeenCalledWith('/local', {
      entries: ['project/readme.md', 'project/sub/nested.ts'],
      strict: false,
    });
  });

  test('skips files git tracks that are missing on disk', async () => {
    gitListing('gone.txt', 'kept.txt');
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

    expect(tar.pack).toHaveBeenCalledWith('/local', { entries: ['project/kept.txt'], strict: false });
  });

  test('fails when a file git lists cannot be inspected', async () => {
    gitListing('secret.txt');
    vi.mocked(lstat).mockImplementation(async (path: Parameters<typeof lstat>[0]) => {
      if (asPosix(path) === '/local/project') {
        return mockDirStat();
      }
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project')).rejects.toThrow(
      'EACCES: permission denied',
    );
    expect(execInteractive).not.toHaveBeenCalled();
  });

  test('refuses to upload when git filtering selects no files', async () => {
    vi.mocked(lstat).mockResolvedValue(mockDirStat());
    gitListing();

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/project', '/sandbox/project')).rejects.toThrow(
      'Git filtering selected no files for "/local/project"',
    );
    expect(tar.pack).not.toHaveBeenCalled();
    expect(execInteractive).not.toHaveBeenCalled();
  });

  test('refuses to upload when every file git lists is missing on disk', async () => {
    gitListing('gone.txt');
    vi.mocked(lstat).mockImplementation(async (path: Parameters<typeof lstat>[0]) => {
      if (asPosix(path) === '/local/project') {
        return mockDirStat();
      }
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    });

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

  test('extracts a directory as <dest>/<basename> whatever the destination', async () => {
    mockDirectoryRoot('/local/skills/my-skill');

    await transfer.uploadToSandbox('my-sandbox', '/local/skills/my-skill', '.claude/skills');

    expect(tar.pack).toHaveBeenCalledWith('/local/skills', { entries: ['my-skill'], strict: false });
    expect(scripts()).toEqual([`mkdir -p -- '.claude/skills' && tar xf - -C '.claude/skills'`]);
  });

  test('archives the contents directly when the directory has no basename', async () => {
    mockDirectoryRoot('/');

    await transfer.uploadToSandbox('my-sandbox', '/', '/sandbox/project');

    const { cwd, options } = packCall();
    expect(cwd).toBe('/');
    expect(options).toEqual({ strict: false });
    expect(options).not.toHaveProperty('entries');
  });

  test('does not prefix git files when the directory has no basename', async () => {
    mockDirectoryRoot('/');
    gitListing('a.txt');

    await transfer.uploadToSandbox('my-sandbox', '/', '/sandbox/project');

    expect(tar.pack).toHaveBeenCalledWith('/', { entries: ['a.txt'], strict: false });
  });
});

describe('staged uploads of archives larger than one part', () => {
  test('stages parts of at most 2 MiB, extracts them in order, then removes the staging directory', async () => {
    const archive = mockArchive(Buffer.alloc(2.5 * partBytes, 'y'));

    await transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin');

    const all = scripts();
    expect(all).toHaveLength(5);
    const stagingDir = stagingDirOf(all[0]);
    expect(stagingDir.startsWith(`'${stagingRoot}/kaiden-upload-`)).toBe(true);
    expect(all).toEqual([
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/part-000000`,
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/part-000001`,
      `mkdir -p -- ${stagingDir} && cat > ${stagingDir}/part-000002`,
      `mkdir -p -- '/remote' && cat ${stagingDir}/part-* | tar xf - -C '/remote'`,
      `rm -rf -- ${stagingDir}`,
    ]);

    const parts = sessions.slice(0, 3).map(session => stdinOf(session));
    expect(parts.map(part => part.length)).toEqual([partBytes, partBytes, archive.length - 2 * partBytes]);
    // Buffer#equals is native; toEqual walks a 5 MiB buffer element by element (seconds).
    expect(Buffer.concat(parts).equals(archive)).toBe(true);
    expect(stdinOf(sessions[3])).toHaveLength(0);
  });

  test('writes stdin in chunks of at most 64 KiB', async () => {
    mockArchive(Buffer.alloc(1.5 * partBytes, 'y'));

    await transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin');

    const chunkSizes = sessions.flatMap(session => vi.mocked(session.write).mock.calls.map(([data]) => data.length));
    expect(Math.max(...chunkSizes)).toBe(stdinChunkBytes);
  });

  test('removes the staging directory and reports the failure when a part cannot be staged', async () => {
    mockArchive(Buffer.alloc(2.5 * partBytes, 'y'));
    sessionOptions = (script): SessionOptions =>
      script.endsWith('part-000001') ? { exitCode: 1, stderr: 'cat: write error: No space left on device' } : {};

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin')).rejects.toThrow(
      'upload staging failed with exit code 1 for "/local/huge.bin" → "/remote/huge.bin" (cat: write error: No space left on device)',
    );

    const all = scripts();
    expect(all).toHaveLength(3);
    expect(all.at(-1)).toBe(`rm -rf -- ${stagingDirOf(all[0])}`);
  });

  test('still reports the upload result when removing the staging directory fails', async () => {
    mockArchive(Buffer.alloc(1.5 * partBytes, 'y'));
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

  test('retries an exec when the gateway is unavailable', async () => {
    vi.useFakeTimers();
    vi.mocked(execInteractive).mockRejectedValueOnce(unavailableError());

    const upload = transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt');
    await vi.runAllTimersAsync();
    await upload;

    expect(execInteractive).toHaveBeenCalledTimes(2);
    expect(stdinOf(sessions[0])).toEqual(ARCHIVE);
  });

  test.each([
    { title: 'a plain error that mentions a connection', error: new Error('connect ECONNREFUSED') },
    { title: 'a message that merely contains "connect"', error: new Error('client disconnected') },
    { title: 'an SDK error with another status', error: new SdkError('not_found', 'sandbox not found') },
  ])('does not retry $title', async ({ error }) => {
    vi.mocked(execInteractive).mockRejectedValue(error);

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt')).rejects.toThrow(
      error.message,
    );
    expect(execInteractive).toHaveBeenCalledOnce();
  });

  test('throws after max retries while the gateway stays unavailable', async () => {
    vi.useFakeTimers();
    vi.mocked(execInteractive).mockRejectedValue(unavailableError());

    const upload = expect(
      transfer.uploadToSandbox('my-sandbox', '/local/file.txt', '/remote/file.txt'),
    ).rejects.toThrow('connect ECONNREFUSED');
    await vi.runAllTimersAsync();
    await upload;

    expect(execInteractive).toHaveBeenCalledTimes(maxRetries);
  });

  test('throws when the archive cannot be built, without starting a remote command', async () => {
    vi.mocked(tar.pack).mockImplementation(
      () =>
        new Readable({
          read(): void {
            this.destroy(new Error('ENOENT: no such file or directory'));
          },
        }) as never,
    );

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/missing', '/remote/dest')).rejects.toThrow('ENOENT');
    expect(execInteractive).not.toHaveBeenCalled();
  });

  test('stops reading local files when a staged upload fails', async () => {
    mockArchive(Buffer.alloc(4.5 * partBytes, 'y'));
    sessionOptions = (script): SessionOptions => (script.endsWith('part-000000') ? { exitCode: 1 } : {});

    await expect(transfer.uploadToSandbox('my-sandbox', '/local/huge.bin', '/remote/huge.bin')).rejects.toThrow(
      'upload staging failed with exit code 1',
    );
    // Only the failed part and the cleanup ran, and the archive stream was destroyed.
    expect(scripts()).toHaveLength(2);
    expect(archives[0]?.destroyed).toBe(true);
  });
});
