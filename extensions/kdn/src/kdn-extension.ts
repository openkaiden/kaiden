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
import { arch } from 'node:os';
import { join } from 'node:path';

import type { CliToolInstallationSource, ExtensionContext } from '@openkaiden/api';
import * as extensionApi from '@openkaiden/api';

import { downloadKdn, getAvailableVersions, getLatestVersion } from './kdn-download';

const DOWNLOAD_TIMEOUT_MS = 60_000;

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
        console.log('binary found in extension storage');
      }
    }

    if (!binaryPath) {
      const systemResult = await this.findOnPath();
      if (systemResult) {
        binaryPath = 'kdn';
        version = systemResult.version;
        installationSource = 'external';
        console.log('kdn binary found in system PATH');
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
            console.log('binary found in bundled resources');
          }
        }
      }
    }

    if (binaryPath) {
      this.registerCliTool(binaryPath, version, installationSource);
      return;
    }

    this.downloadAndRegister(localBinaryPath, binDir).catch((err: unknown) => {
      console.error('background kdn download failed', err);
    });
  }

  async deactivate(): Promise<void> {}

  private registerCliTool(
    binaryPath: string,
    version: string | undefined,
    installationSource: CliToolInstallationSource,
  ): void {
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

    if (installationSource === 'extension') {
      const binDir = join(this.extensionContext.storagePath, 'bin');
      const binaryName = extensionApi.env.isWindows ? 'kdn.exe' : 'kdn';
      const localBinaryPath = join(binDir, binaryName);
      let currentVersion = version;
      let versionToUpdate: string | undefined;

      const updater = cliTool.registerUpdate({
        selectVersion: async (): Promise<string> => {
          const releases = await getAvailableVersions();
          const filtered = releases.filter(r => r.tag !== currentVersion);
          const selected = await extensionApi.window.showQuickPick(filtered, {
            placeHolder: 'Select kdn version to install',
          });
          if (!selected) {
            throw new Error('No version selected');
          }
          versionToUpdate = selected.tag;
          return versionToUpdate;
        },
        doUpdate: async (): Promise<void> => {
          if (!versionToUpdate) {
            throw new Error('No version selected for update');
          }
          await downloadKdn(versionToUpdate, process.platform, arch(), binDir);
          const newVersion = await this.getVersion(localBinaryPath);
          if (!newVersion) {
            throw new Error('failed to determine version after update');
          }
          cliTool.updateVersion({
            version: newVersion,
            path: localBinaryPath,
          });
          currentVersion = newVersion;
          versionToUpdate = undefined;
        },
      });
      this.extensionContext.subscriptions.push(updater);
    }
  }

  private async downloadAndRegister(localBinaryPath: string, binDir: string): Promise<void> {
    await extensionApi.window.withProgress(
      { location: extensionApi.ProgressLocation.TASK_WIDGET, title: 'Downloading kdn CLI' },
      async (_progress, token) => {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), DOWNLOAD_TIMEOUT_MS);
        token.onCancellationRequested(() => abortController.abort());

        try {
          const latestVersion = await getLatestVersion(abortController.signal);
          await downloadKdn(latestVersion, process.platform, arch(), binDir, abortController.signal);
          const version = await this.getVersion(localBinaryPath);
          if (version) {
            this.registerCliTool(localBinaryPath, version, 'extension');
          }
        } finally {
          clearTimeout(timeoutId);
        }
      },
    );
  }

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
