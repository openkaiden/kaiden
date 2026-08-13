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

import { env } from '@openkaiden/api';
import { injectable } from 'inversify';

export interface ReadOnlyFileMount {
  /** File on the host. */
  source: string;
  /** Path in the container. */
  target: string;
}

@injectable()
export class MountHelper {
  private static readonly WINDOWS_PATH_REGEXP = /^([A-Za-z]):[/\\](.*)$/;

  /**
   * Binds mounting host files read-only in a container. They are relabelled with :Z so that SELinux enforcing hosts
   * let the container read them (no effect elsewhere). On Windows, the source is translated to its WSL path.
   */
  getReadOnlyFileBinds(mounts: ReadOnlyFileMount[]): string[] {
    return mounts.map(({ source, target }) => {
      const hostPath = env.isWindows ? this.toWslPath(source) : source;
      return `${hostPath}:${target}:ro,Z`;
    });
  }

  // C:\Users\me -> /mnt/c/Users/me, where the WSL virtual machine of the engine mounts the Windows drives
  private toWslPath(windowsPath: string): string {
    const match = MountHelper.WINDOWS_PATH_REGEXP.exec(windowsPath);
    if (!match) {
      return windowsPath;
    }
    const [, drive, rest] = match;
    return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
  }
}
