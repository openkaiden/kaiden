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
 **********************************************************************/

import { execFile } from 'node:child_process';
import { chmod, readdir } from 'node:fs/promises';
import { platform } from 'node:os';
import { promisify } from 'node:util';

import { beforeEach, expect, test, vi } from 'vitest';

import { HomebrewRelocator } from './darwin-relocate';

vi.mock(import('node:child_process'));
vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));

const execFileAsync = vi.mocked(promisify(execFile));
const readdirMock = vi.mocked(readdir as (path: string) => Promise<string[]>);

const MKE2FS_OTOOL = `/rt/mke2fs:
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`;
const DEBUGFS_OTOOL = `/rt/debugfs:
\t@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib (compatibility version 13.0.0, current version 13.6.0)
\t@@HOMEBREW_CELLAR@@/e2fsprogs/1.47.4/lib/libext2fs.2.1.dylib (compatibility version 1.0.0, current version 2.1.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`;
const E2FSCK_OTOOL = `/rt/e2fsck:
\t@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib (compatibility version 13.0.0, current version 13.6.0)
\t@@HOMEBREW_CELLAR@@/e2fsprogs/1.47.4/lib/libext2fs.2.1.dylib (compatibility version 1.0.0, current version 2.1.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`;
const LIBEXT2FS_OTOOL = `/rt/lib/libext2fs.2.1.dylib:
\t@@HOMEBREW_PREFIX@@/opt/e2fsprogs/lib/libext2fs.2.1.dylib (compatibility version 1.0.0, current version 2.1.0)
\t@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib (compatibility version 13.0.0, current version 13.6.0)
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
`;
const LIBINTL_OTOOL = `/rt/lib/libintl.8.dylib:
\t@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib (compatibility version 13.0.0, current version 13.6.0)
`;

// Each file runs otool -L, then install_name_tool when needed, then codesign; only otool output matters.
function queueOutputs(outputs: string[]): void {
  for (const stdout of outputs) {
    execFileAsync.mockResolvedValueOnce({ stdout, stderr: '' });
  }
}

function argsOf(command: string): (readonly string[] | undefined)[] {
  return execFileAsync.mock.calls.filter(([file]) => file === command).map(([, args]) => args ?? undefined);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platform).mockReturnValue('darwin');
  readdirMock.mockResolvedValue(['libext2fs.2.1.dylib', 'libintl.8.dylib', 'NOTICE']);
  execFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
});

test('rewrites Homebrew placeholders to @loader_path and re-signs each file', async () => {
  queueOutputs([MKE2FS_OTOOL, '', DEBUGFS_OTOOL, '', '', E2FSCK_OTOOL, '', '', LIBEXT2FS_OTOOL, '', '', LIBINTL_OTOOL]);

  await expect(new HomebrewRelocator().relocate('/rt')).resolves.toBe(true);

  expect(chmod).toHaveBeenCalledWith('/rt/mke2fs', 0o755);
  expect(chmod).toHaveBeenCalledWith('/rt/debugfs', 0o755);
  expect(chmod).toHaveBeenCalledWith('/rt/e2fsck', 0o755);
  expect(chmod).toHaveBeenCalledWith('/rt/lib/libext2fs.2.1.dylib', 0o644);
  expect(chmod).toHaveBeenCalledWith('/rt/lib/libintl.8.dylib', 0o644);
  expect(argsOf('/usr/bin/install_name_tool')).toEqual([
    [
      '-change',
      '@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib',
      '@loader_path/lib/libintl.8.dylib',
      '-change',
      '@@HOMEBREW_CELLAR@@/e2fsprogs/1.47.4/lib/libext2fs.2.1.dylib',
      '@loader_path/lib/libext2fs.2.1.dylib',
      '/rt/debugfs',
    ],
    [
      '-change',
      '@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib',
      '@loader_path/lib/libintl.8.dylib',
      '-change',
      '@@HOMEBREW_CELLAR@@/e2fsprogs/1.47.4/lib/libext2fs.2.1.dylib',
      '@loader_path/lib/libext2fs.2.1.dylib',
      '/rt/e2fsck',
    ],
    [
      '-id',
      '@loader_path/libext2fs.2.1.dylib',
      '-change',
      '@@HOMEBREW_PREFIX@@/opt/e2fsprogs/lib/libext2fs.2.1.dylib',
      '@loader_path/libext2fs.2.1.dylib',
      '-change',
      '@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib',
      '@loader_path/libintl.8.dylib',
      '/rt/lib/libext2fs.2.1.dylib',
    ],
    [
      '-id',
      '@loader_path/libintl.8.dylib',
      '-change',
      '@@HOMEBREW_PREFIX@@/opt/gettext/lib/libintl.8.dylib',
      '@loader_path/libintl.8.dylib',
      '/rt/lib/libintl.8.dylib',
    ],
  ]);
  expect(argsOf('/usr/bin/codesign')).toEqual([
    ['--force', '--sign', '-', '/rt/mke2fs'],
    ['--force', '--sign', '-', '/rt/debugfs'],
    ['--force', '--sign', '-', '/rt/e2fsck'],
    ['--force', '--sign', '-', '/rt/lib/libext2fs.2.1.dylib'],
    ['--force', '--sign', '-', '/rt/lib/libintl.8.dylib'],
  ]);
});

test.each(['linux', 'win32'] as const)('skips relocation when downloading macOS binaries on %s', async host => {
  vi.mocked(platform).mockReturnValue(host);

  await expect(new HomebrewRelocator().relocate('/rt')).resolves.toBe(false);

  expect(execFileAsync).not.toHaveBeenCalled();
  expect(chmod).not.toHaveBeenCalled();
});

test('propagates install_name_tool failures', async () => {
  queueOutputs([MKE2FS_OTOOL, '', DEBUGFS_OTOOL]);
  execFileAsync.mockRejectedValueOnce(new Error('install_name_tool failed'));

  await expect(new HomebrewRelocator().relocate('/rt')).rejects.toThrow('install_name_tool failed');
  expect(argsOf('/usr/bin/codesign')).toEqual([['--force', '--sign', '-', '/rt/mke2fs']]);
});

test('fails when a Homebrew dependency is not bundled', async () => {
  queueOutputs([
    MKE2FS_OTOOL,
    '',
    '/rt/debugfs:\n\t@@HOMEBREW_PREFIX@@/opt/foo/lib/libfoo.1.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
  ]);

  await expect(new HomebrewRelocator().relocate('/rt')).rejects.toThrow(
    'Cannot relocate /rt/debugfs: bundled library not found for @@HOMEBREW_PREFIX@@/opt/foo/lib/libfoo.1.dylib',
  );
  expect(argsOf('/usr/bin/install_name_tool')).toEqual([]);
});
