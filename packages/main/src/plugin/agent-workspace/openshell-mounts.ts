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

import { lstat } from 'node:fs/promises';
import { basename, posix } from 'node:path';

import type { OpenshellBindMount, OpenshellUpload } from '/@api/openshell-gateway-info.js';

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
  { supportsMounts, readOnly = false }: { supportsMounts: boolean; readOnly?: boolean },
): Promise<{ uploads: OpenshellUpload[]; mounts: OpenshellBindMount[] }> {
  if (!supportsMounts) {
    return { uploads, mounts: [] };
  }
  const remainingUploads: OpenshellUpload[] = [];
  const mounts: OpenshellBindMount[] = [];
  for (const upload of uploads) {
    const stats = await lstat(upload.local);
    const destination =
      stats.isDirectory() || upload.remote.endsWith('/')
        ? posix.join(upload.remote, basename(upload.local))
        : upload.remote;
    const target = resolveOpenshellMountTarget(destination);
    if (target) {
      mounts.push({ type: 'bind', source: upload.local, target, read_only: readOnly });
    } else {
      remainingUploads.push(upload);
    }
  }
  return { uploads: remainingUploads, mounts };
}

export function dedupeOpenshellMounts(mounts: OpenshellBindMount[]): OpenshellBindMount[] {
  const mountsByTarget = new Map<string, OpenshellBindMount>();
  for (const mount of mounts) {
    const existing = mountsByTarget.get(mount.target);
    if (existing && existing.source !== mount.source) {
      throw new Error(`Conflicting bind mount sources for target "${mount.target}"`);
    }
    mountsByTarget.set(mount.target, mount);
  }
  return [...mountsByTarget.values()];
}
