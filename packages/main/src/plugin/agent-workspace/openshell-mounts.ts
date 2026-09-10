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

import { lstat, realpath } from 'node:fs/promises';
import { basename, posix } from 'node:path';

export type OpenshellUpload = { local: string; remote: string };
export type OpenshellBindMount = { type: 'bind'; source: string; target: string; read_only: boolean };

export async function buildOpenshellUploadMount(
  upload: OpenshellUpload,
  readOnly = false,
): Promise<OpenshellBindMount | undefined> {
  // Directory uploads retain their basename under the destination. In particular,
  // project:. lands at /sandbox/project, not the reserved /sandbox root.
  const stats = await lstat(upload.local);
  const remote =
    stats.isDirectory() || upload.remote.endsWith('/')
      ? posix.join(upload.remote, basename(upload.local))
      : upload.remote;
  const target = resolveOpenshellMountTarget(remote);
  return target ? { type: 'bind', source: await realpath(upload.local), target, read_only: readOnly } : undefined;
}

export function resolveOpenshellMountTarget(path: string): string | undefined {
  if (path === '.' || path === '~' || path === '/') {
    return undefined;
  }
  if (posix.isAbsolute(path)) {
    const normalized = posix.normalize(path).replace(/\/$/, '');
    return normalized === '' || normalized === '/sandbox' ? undefined : normalized;
  }
  const normalized = posix.join('/sandbox', path.startsWith('~/') ? path.slice(2) : path).replace(/\/$/, '');
  return normalized.startsWith('/sandbox/') ? normalized : undefined;
}

export async function partitionOpenshellUploads(
  uploads: OpenshellUpload[],
  supportsMounts: boolean,
  readOnly = false,
): Promise<{ uploads: OpenshellUpload[]; mounts: OpenshellBindMount[] }> {
  const remainingUploads: OpenshellUpload[] = [];
  const mounts: OpenshellBindMount[] = [];
  for (const upload of uploads) {
    const mount = supportsMounts ? await buildOpenshellUploadMount(upload, readOnly) : undefined;
    if (mount) {
      mounts.push(mount);
    } else {
      remainingUploads.push(upload);
    }
  }
  return { uploads: remainingUploads, mounts };
}

export function dedupeOpenshellMounts(mounts: OpenshellBindMount[]): OpenshellBindMount[] {
  const deduped = new Map<string, OpenshellBindMount>();
  for (const mount of mounts) {
    const existing = deduped.get(mount.target);
    if (existing && existing.source !== mount.source) {
      throw new Error(`Conflicting bind mount sources for target "${mount.target}"`);
    }
    // Configured mounts follow the automatic project mount, so their ro flag wins.
    deduped.set(mount.target, mount);
  }
  return [...deduped.values()];
}
