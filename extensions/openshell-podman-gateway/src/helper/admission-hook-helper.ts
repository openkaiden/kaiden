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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionContext } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { ExtensionContextSymbol } from '/@/inject/symbol';

@injectable()
export class AdmissionHookHelper {
  private static readonly ADMISSION_HOOK_BINARY = 'openshell-admission-hook';

  @inject(ExtensionContextSymbol)
  private extensionContext!: ExtensionContext;

  getAdmissionHookBinary(): string {
    return AdmissionHookHelper.ADMISSION_HOOK_BINARY;
  }

  /**
   * Returns the folder holding the Linux openshell-admission-hook binary, or undefined if it is missing.
   * Packaged builds ship it in the openshell-admission-hook resources folder, development builds use the
   * assets folder populated by scripts/download.ts.
   */
  getHookDirectory(): string | undefined {
    let hookDir: string | undefined;
    if (import.meta.env.PROD) {
      const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      hookDir = resourcesPath ? join(resourcesPath, AdmissionHookHelper.ADMISSION_HOOK_BINARY) : undefined;
    } else {
      hookDir = join(this.extensionContext.extensionUri.fsPath, 'assets', `${process.platform}-${process.arch}`);
    }
    if (hookDir && existsSync(join(hookDir, AdmissionHookHelper.ADMISSION_HOOK_BINARY))) {
      return hookDir;
    }
    return undefined;
  }
}
