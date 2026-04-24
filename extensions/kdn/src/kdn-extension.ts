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

import type { CliToolInstallationSource, ExtensionContext } from '@openkaiden/api';
import * as extensionApi from '@openkaiden/api';

export class KdnExtension {
  constructor(private readonly extensionContext: ExtensionContext) {}

  async activate(): Promise<void> {
    const binDir = join(this.extensionContext.storagePath, 'bin');
    const binaryName = extensionApi.env.isWindows ? 'kdn.exe' : 'kdn';
    const localBinaryPath = join(binDir, binaryName);

    let binaryPath: string | undefined;
    let version: string | undefined;
    let installationSource: CliToolInstallationSource = 'external';

    if (existsSync(localBinaryPath)) {
      version = await this.getVersion(localBinaryPath);
      if (version) {
        binaryPath = localBinaryPath;
        installationSource = 'extension';
      }
    }

    if (!binaryPath) {
      const systemResult = await this.findOnPath();
      if (systemResult) {
        binaryPath = 'kdn';
        version = systemResult.version;
        installationSource = 'external';
      }
    }

    if (!binaryPath) {
      const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      if (resourcesPath) {
        const bundledBinaryPath = join(resourcesPath, 'kdn', binaryName);
        if (existsSync(bundledBinaryPath)) {
          version = await this.getVersion(bundledBinaryPath);
          if (version) {
            binaryPath = bundledBinaryPath;
            installationSource = 'extension';
          }
        }
      }
    }

    if (!binaryPath) {
      console.error('kdn CLI not found in extension storage, PATH, or bundled resources');
      return;
    }

    const cliTool = extensionApi.cli.createCliTool({
      name: 'kdn',
      displayName: 'kdn',
      markdownDescription: 'Kaiden CLI for managing agent workspaces',
      images: {},
      version,
      path: binaryPath,
      installationSource,
    });
    this.extensionContext.subscriptions.push(cliTool);
  }

  async deactivate(): Promise<void> {}

  private parseVersion(output: string): string | undefined {
    const parts = output.trim().split(/\s+/);
    return parts[parts.length - 1] || undefined;
  }

  private async getVersion(binaryPath: string): Promise<string | undefined> {
    try {
      const result = await extensionApi.process.exec(binaryPath, ['version']);
      return this.parseVersion(result.stdout || result.stderr);
    } catch {
      return undefined;
    }
  }

  private async findOnPath(): Promise<{ version: string } | undefined> {
    try {
      const result = await extensionApi.process.exec('kdn', ['version']);
      const version = this.parseVersion(result.stdout || result.stderr);
      if (version) return { version };
    } catch {
      // not on PATH
    }
    return undefined;
  }
}
