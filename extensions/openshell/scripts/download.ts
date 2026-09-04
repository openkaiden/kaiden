#!/usr/bin/env tsx
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

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  downloadBinaries,
  getRelease,
  OPENSHELL_DOWNLOAD,
  OPENSHELL_IMAGE_BUILDER_DOWNLOAD,
  OPENSHELL_WINDOWS_GATEWAY_DOWNLOAD,
  type GitHubArtifactDownload,
} from '../src/openshell-download';
import { downloadMkfsExt4 } from '../src/e2fsprogs-download';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '..', 'assets');

const SUPPORTED_TARGETS: { platform: string; arch: string }[] = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
];

interface PackageJson {
  e2fsprogsVersion: string;
  openshellVersion: string;
  openshellImageBuilderVersion: string;
  openshellWindowsGatewayVersion: string;
}

interface DownloadEntry {
  id: string;
  config: GitHubArtifactDownload;
  versionProperty: keyof PackageJson;
  outputSubdirectory?: string;
}

const DOWNLOADS: DownloadEntry[] = [
  {
    id: 'openshell',
    config: OPENSHELL_DOWNLOAD,
    versionProperty: 'openshellVersion',
  },
  {
    id: 'image-builder',
    config: OPENSHELL_IMAGE_BUILDER_DOWNLOAD,
    versionProperty: 'openshellImageBuilderVersion',
    outputSubdirectory: 'image-builder',
  },
  {
    id: 'windows-gateway',
    config: OPENSHELL_WINDOWS_GATEWAY_DOWNLOAD,
    versionProperty: 'openshellWindowsGatewayVersion',
  },
];

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    all: { type: 'boolean', default: false },
    platform: { type: 'string' },
    arch: { type: 'string' },
    component: { type: 'string' },
  },
  strict: true,
});

const selectedDownloads = values.component ? DOWNLOADS.filter(entry => entry.id === values.component) : DOWNLOADS;
if (selectedDownloads.length === 0) {
  console.error(
    `Unsupported component "${values.component}". Use one of: ${DOWNLOADS.map(entry => entry.id).join(', ')}`,
  );
  process.exit(1);
}

let targets: { platform: string; arch: string }[];

if (values.all) {
  targets = SUPPORTED_TARGETS;
} else if (values.platform && values.arch) {
  const requested = { platform: values.platform, arch: values.arch };
  const isSupported = SUPPORTED_TARGETS.some(t => t.platform === requested.platform && t.arch === requested.arch);
  if (!isSupported) {
    console.error(
      `Unsupported target "${requested.platform}-${requested.arch}". Use --all or one of: ${SUPPORTED_TARGETS.map(t => `${t.platform}-${t.arch}`).join(', ')}`,
    );
    process.exit(1);
  }
  targets = [requested];
} else if (values.platform || values.arch) {
  console.error('--platform and --arch must be specified together');
  process.exit(1);
} else {
  targets = SUPPORTED_TARGETS.filter(t => t.platform === process.platform);
}

if (targets.length === 0) {
  console.log(
    `No supported OpenShell target for host platform "${process.platform}", skipping. Use --all or pass --platform and --arch to download for a specific target.`,
  );
  process.exit(0);
}

(async () => {
  const pkgPath = resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;

  for (const downloadEntry of selectedDownloads) {
    const pinnedVersion = pkg[downloadEntry.versionProperty];
    if (!pinnedVersion) {
      console.error(`missing "${downloadEntry.versionProperty}" in package.json`);
      process.exit(1);
    }

    const { version, digests } = await getRelease(downloadEntry.config, pinnedVersion);
    console.log(`${downloadEntry.config.name} pinned release: v${version}`);

    for (const { platform, arch } of targets) {
      const key = `${platform}-${arch}`;
      if (!downloadEntry.config.assets[key]) {
        console.log(`No ${downloadEntry.config.name} assets for ${key}, skipping.`);
        continue;
      }
      const outputDir = downloadEntry.outputSubdirectory
        ? resolve(ASSETS_DIR, downloadEntry.outputSubdirectory, `${platform}-${arch}`)
        : resolve(ASSETS_DIR, `${platform}-${arch}`);
      await downloadBinaries(downloadEntry.config, version, platform, arch, outputDir, digests);
    }
  }

  if (selectedDownloads.some(entry => entry.id === 'openshell')) {
    for (const { platform, arch } of targets.filter(
      target => target.platform === 'linux' || target.platform === 'darwin',
    )) {
      await downloadMkfsExt4(pkg.e2fsprogsVersion, arch, platform, resolve(ASSETS_DIR, `${platform}-${arch}`));
    }
  }
})();
