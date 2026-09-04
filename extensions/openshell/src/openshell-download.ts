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

import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';

import AdmZip from 'adm-zip';
import * as tar from 'tar';

import { sha256 } from './sha256';

export interface ReleaseInfo {
  version: string;
  digests: Map<string, string>;
}

interface AssetSpec {
  assetName: string | string[];
  binaryName: string;
  subdir?: string;
}

export interface GitHubArtifactDownload {
  name: string;
  repository: string;
  tagPrefix?: string;
  assets: Record<string, AssetSpec[]>;
}

export const OPENSHELL_DOWNLOAD: GitHubArtifactDownload = {
  name: 'openshell',
  repository: 'NVIDIA/OpenShell',
  assets: {
    'darwin-arm64': [
      { assetName: 'openshell-aarch64-apple-darwin.tar.gz', binaryName: 'openshell' },
      {
        assetName: 'openshell-gateway-aarch64-apple-darwin.tar.gz',
        binaryName: 'openshell-gateway',
      },
      {
        assetName: 'openshell-driver-vm-aarch64-apple-darwin.tar.gz',
        binaryName: 'openshell-driver-vm',
      },
    ],
    'linux-x64': [
      { assetName: 'openshell-x86_64-unknown-linux-musl.tar.gz', binaryName: 'openshell' },
      {
        assetName: 'openshell-gateway-x86_64-unknown-linux-gnu.tar.gz',
        binaryName: 'openshell-gateway',
      },
      {
        assetName: [
          'openshell-sandbox-x86_64-unknown-linux-musl.tar.gz',
          'openshell-sandbox-x86_64-unknown-linux-gnu.tar.gz',
        ],
        binaryName: 'openshell-sandbox',
      },
      {
        assetName: 'openshell-driver-vm-x86_64-unknown-linux-gnu.tar.gz',
        binaryName: 'openshell-driver-vm',
      },
    ],
    'linux-arm64': [
      { assetName: 'openshell-aarch64-unknown-linux-musl.tar.gz', binaryName: 'openshell' },
      {
        assetName: 'openshell-gateway-aarch64-unknown-linux-gnu.tar.gz',
        binaryName: 'openshell-gateway',
      },
      {
        assetName: [
          'openshell-sandbox-aarch64-unknown-linux-musl.tar.gz',
          'openshell-sandbox-aarch64-unknown-linux-gnu.tar.gz',
        ],
        binaryName: 'openshell-sandbox',
      },
      {
        assetName: 'openshell-driver-vm-aarch64-unknown-linux-gnu.tar.gz',
        binaryName: 'openshell-driver-vm',
      },
    ],
  },
};

export const OPENSHELL_IMAGE_BUILDER_DOWNLOAD: GitHubArtifactDownload = {
  name: 'openshell-image-builder',
  repository: 'openkaiden/openshell-image-builder',
  assets: {
    'darwin-arm64': [
      {
        assetName: 'openshell-image-builder-aarch64-apple-darwin',
        binaryName: 'openshell-image-builder',
      },
    ],
    'linux-x64': [
      {
        assetName: 'openshell-image-builder-x86_64-unknown-linux-gnu',
        binaryName: 'openshell-image-builder',
      },
    ],
    'linux-arm64': [
      {
        assetName: 'openshell-image-builder-aarch64-unknown-linux-gnu',
        binaryName: 'openshell-image-builder',
      },
    ],
    'win32-x64': [
      {
        assetName: 'openshell-image-builder-x86_64-pc-windows-msvc.exe',
        binaryName: 'openshell-image-builder.exe',
      },
    ],
  },
};

export const OPENSHELL_WINDOWS_GATEWAY_DOWNLOAD: GitHubArtifactDownload = {
  name: 'openshell-windows-gateway',
  repository: 'jeffmaury/openshell-dist',
  tagPrefix: '',
  assets: {
    'win32-x64': [{ assetName: 'openshell-x86_64-pc-windows-msvc.zip', binaryName: 'openshell-gateway.exe' }],
    'win32-arm64': [{ assetName: 'openshell-aarch64-pc-windows-msvc.zip', binaryName: 'openshell-gateway.exe' }],
  },
};

export async function getRelease(downloadConfig: GitHubArtifactDownload, version: string): Promise<ReleaseInfo> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  const token = process.env['GITHUB_TOKEN'];
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const prefix = downloadConfig.tagPrefix ?? 'v';
  const tag = `${prefix}${version}`;
  const res = await fetch(`https://api.github.com/repos/${downloadConfig.repository}/releases/tags/${tag}`, {
    headers,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`failed to fetch ${downloadConfig.name} release ${tag}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { tag_name: string; assets: { name: string; digest: string | null }[] };
  const resolvedVersion = prefix ? data.tag_name.replace(new RegExp(`^${prefix}`), '') : data.tag_name;
  const digests = new Map<string, string>();
  for (const asset of data.assets) {
    if (asset.digest) {
      digests.set(asset.name, asset.digest.replace(/^sha256:/, ''));
    }
  }
  return { version: resolvedVersion, digests };
}

async function download(url: string, dest: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = process.env['GITHUB_TOKEN'];
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

async function verifyChecksum(digests: Map<string, string>, assetFileName: string, filePath: string): Promise<void> {
  const expected = digests.get(assetFileName);
  if (!expected) {
    throw new Error(`no digest found for ${assetFileName} in release assets`);
  }

  const actual = await sha256(filePath);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${assetFileName}: expected ${expected}, got ${actual}`);
  }
  console.log(`checksum verified for ${assetFileName}`);
}

function isSafePath(entryName: string): boolean {
  const normalized = normalize(entryName.replace(/\\/g, '/'));
  return !normalized.startsWith('..') && !normalized.startsWith('/');
}

async function extract(archive: string, outDir: string): Promise<void> {
  await tar.extract({
    file: archive,
    cwd: outDir,
    filter: (path: string) => isSafePath(path),
  });
}

function extractZip(archive: string, outDir: string): void {
  const zip = new AdmZip(archive);
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory && isSafePath(entry.entryName)) {
      zip.extractEntryTo(entry, outDir, false, true);
    }
  }
}

export async function downloadBinaries(
  downloadConfig: GitHubArtifactDownload,
  version: string,
  platform: string,
  arch: string,
  outputDir: string,
  digests: Map<string, string>,
): Promise<void> {
  const key = `${platform}-${arch}`;
  const assets = downloadConfig.assets[key];
  if (!assets) {
    throw new Error(`unsupported target: ${key}. Supported: ${Object.keys(downloadConfig.assets).join(', ')}`);
  }

  const versionFile = join(outputDir, `.${downloadConfig.name}-version`);
  const versionMarker = `${version}-${platform}-${arch}`;

  if (existsSync(versionFile)) {
    const existing = await readFile(versionFile, { encoding: 'utf-8' });
    const allPresent = assets.every(asset => {
      const dir = asset.subdir ? join(outputDir, asset.subdir) : outputDir;
      return existsSync(join(dir, asset.binaryName));
    });
    if (existing.trim() === versionMarker && allPresent) {
      console.log(`${downloadConfig.name} ${version} for ${platform}/${arch} already downloaded`);
      return;
    }
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const asset of assets) {
    const assetDir = asset.subdir ? join(outputDir, asset.subdir) : outputDir;
    await mkdir(assetDir, { recursive: true });

    const assetNames = Array.isArray(asset.assetName) ? asset.assetName : [asset.assetName];
    const assetName = assetNames.find(name => digests.has(name)) ?? assetNames[0];
    const prefix = downloadConfig.tagPrefix ?? 'v';
    const url = `https://github.com/${downloadConfig.repository}/releases/download/${prefix}${version}/${assetName}`;
    const downloadPath = join(assetDir, assetName);
    const binaryPath = join(assetDir, asset.binaryName);

    console.log(`downloading ${asset.binaryName} ${version} for ${platform}/${arch}...`);
    await download(url, downloadPath);
    await verifyChecksum(digests, assetName, downloadPath);

    if (assetName.endsWith('.tar.gz')) {
      console.log(`extracting ${asset.binaryName}...`);
      await extract(downloadPath, assetDir);
      await rm(downloadPath);
    } else if (assetName.endsWith('.zip')) {
      console.log(`extracting ${asset.binaryName}...`);
      extractZip(downloadPath, assetDir);
      await rm(downloadPath);
    } else if (downloadPath !== binaryPath) {
      await rename(downloadPath, binaryPath);
    }

    if (!existsSync(binaryPath)) {
      throw new Error(`expected binary at ${binaryPath}`);
    }
    if (platform !== 'win32') {
      await chmod(binaryPath, 0o755);
    }
  }

  await writeFile(versionFile, versionMarker, { encoding: 'utf-8' });
  console.log(`${downloadConfig.name} ${version} for ${platform}/${arch} ready`);
}
