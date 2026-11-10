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
import { basename, join } from 'node:path/posix';
import { promisify } from 'node:util';

/**
 * Homebrew bottles keep `@@HOMEBREW_*@@` placeholder install names until Homebrew relocates them.
 * Rewrites them to `@loader_path` so the binaries find their bundled libraries without
 * DYLD_LIBRARY_PATH, which hardened runtime ignores once the app is signed.
 *
 * Resolves `false` without changing anything when the host is not macOS, `true` once relocated.
 *
 * @param runtimeDir directory holding the executables, with their libraries in its `lib` subdirectory
 * @param executables file names of the executables to relocate, relative to `runtimeDir`
 */
export class HomebrewRelocator {
  async relocate(runtimeDir: string, executables: string[]): Promise<boolean> {
    if (platform() !== 'darwin') {
      console.warn(`Skipping relocation of macOS e2fsprogs binaries in ${runtimeDir}: host is not macOS`);
      return false;
    }

    const libDir = join(runtimeDir, 'lib');
    const dylibs = (await readdir(libDir)).filter(file => file.endsWith('.dylib'));
    const targets = [
      ...executables.map(file => ({
        path: join(runtimeDir, file),
        prefix: '@loader_path/lib/',
        mode: 0o755,
      })),
      ...dylibs.map(file => ({ path: join(libDir, file), prefix: '@loader_path/', mode: 0o644 })),
    ];

    const execFileAsync = promisify(execFile);
    for (const { path, prefix, mode } of targets) {
      await chmod(path, mode);
      const placeholders = (await execFileAsync('/usr/bin/otool', ['-L', path])).stdout
        .split('\n')
        .map(line => line.trim().split(' ')[0] ?? '')
        .filter(name => name.startsWith('@@HOMEBREW_'));
      const missing = placeholders.filter(name => !dylibs.includes(basename(name)));
      if (missing.length > 0) {
        throw new Error(`Cannot relocate ${path}: bundled library not found for ${missing.join(', ')}`);
      }
      const args = placeholders.flatMap(old => ['-change', old, `${prefix}${basename(old)}`]);
      if (prefix === '@loader_path/') {
        args.unshift('-id', `@loader_path/${basename(path)}`);
      }
      if (args.length > 0) {
        await execFileAsync('/usr/bin/install_name_tool', [...args, path]);
      }
      await execFileAsync('/usr/bin/codesign', ['--force', '--sign', '-', path]);
    }
    return true;
  }
}
