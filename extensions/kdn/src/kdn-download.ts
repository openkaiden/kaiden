/*********************************************************************
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
 ********************************************************************/

import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs as nodeParseArgs } from 'node:util';

import AdmZip from 'adm-zip';
import * as tar from 'tar';

import { sha256 } from './sha256';

const KDN_REPO = 'openkaiden/kdn';

export async function getLatestVersion(): Promise<string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
  const token = process.env['GITHUB_TOKEN'];
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`https://api.github.com/repos/${KDN_REPO}/releases/latest`, {
    headers,
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`failed to fetch latest kdn release: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { tag_name: string };
  return data.tag_name.replace(/^v/, '');
}

const PLATFORM_MAP: Record<string, string> = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
const ARCH_MAP: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };

export async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

export async function verifyChecksum(version: string, assetFileName: string, filePath: string): Promise<void> {
  const checksumsUrl = `https://github.com/${KDN_REPO}/releases/download/v${version}/kdn_${version}_checksums.txt`;
  const res = await fetch(checksumsUrl, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`failed to download checksums: ${res.status} ${res.statusText}`);
  }

  const content = await res.text();
  const line = content.split('\n').find(l => {
    const parts = l.trim().split(/\s+/);
    return parts.length >= 2 && parts[parts.length - 1] === assetFileName;
  });
  if (!line) {
    throw new Error(`no checksum found for ${assetFileName}`);
  }

  const expected = line.trim().split(/\s+/)[0]!;
  const actual = await sha256(filePath);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${assetFileName}: expected ${expected}, got ${actual}`);
  }
  console.log(`checksum verified for ${assetFileName}`);
}

function isSafePath(entryName: string): boolean {
  if (isAbsolute(entryName)) {
    return false;
  }
  const normalized = normalize(entryName.replace(/\\/g, '/'));
  return !normalized.startsWith('..') && !isAbsolute(normalized);
}

export async function extract(archive: string, outDir: string): Promise<void> {
  if (archive.endsWith('.zip')) {
    const zip = new AdmZip(archive);
    for (const entry of zip.getEntries()) {
      if (!isSafePath(entry.entryName)) {
        throw new Error(`unsafe path in zip: ${entry.entryName}`);
      }
      const fullPath = join(outDir, entry.entryName);
      if (entry.isDirectory) {
        await mkdir(fullPath, { recursive: true });
      } else {
        await mkdir(join(fullPath, '..'), { recursive: true });
        await writeFile(fullPath, entry.getData());
      }
    }
  } else if (archive.endsWith('.tar.gz')) {
    await tar.extract({ file: archive, cwd: outDir });
  } else {
    throw new Error(`unsupported archive: ${archive}`);
  }
}

export async function downloadKdn(version: string, platform: string, arch: string, outputDir: string): Promise<void> {
  const versionFile = join(outputDir, '.kdn-version');
  const versionMarker = `${version}-${platform}-${arch}`;
  const binaryPath = join(outputDir, platform === 'win32' ? 'kdn.exe' : 'kdn');

  if (existsSync(versionFile) && existsSync(binaryPath)) {
    const existing = await readFile(versionFile, { encoding: 'utf-8' });
    if (existing.trim() === versionMarker) {
      console.log(`kdn ${version} for ${platform}/${arch} already downloaded`);
      return;
    }
  }

  const kdnPlatform = PLATFORM_MAP[platform];
  const kdnArch = ARCH_MAP[arch];
  if (!kdnPlatform) throw new Error(`unsupported platform: ${platform}`);
  if (!kdnArch) throw new Error(`unsupported arch: ${arch}`);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const ext = platform === 'win32' ? 'zip' : 'tar.gz';
  const assetFileName = `kdn_${version}_${kdnPlatform}_${kdnArch}.${ext}`;
  const url = `https://github.com/${KDN_REPO}/releases/download/v${version}/${assetFileName}`;
  const archivePath = join(outputDir, assetFileName);

  console.log(`downloading kdn ${version} for ${platform}/${arch}...`);
  await download(url, archivePath);
  await verifyChecksum(version, assetFileName, archivePath);

  console.log(`extracting to ${outputDir}...`);
  await extract(archivePath, outputDir);
  await rm(archivePath);

  if (!existsSync(binaryPath)) {
    throw new Error(`expected extracted binary at ${binaryPath}`);
  }

  if (platform !== 'win32') {
    await chmod(binaryPath, 0o755);
  }

  await writeFile(versionFile, versionMarker, { encoding: 'utf-8' });
  console.log(`kdn ${version} for ${platform}/${arch} ready`);
}

function parseArgs(args: string[]): { output: string; platform: string; arch: string } {
  const { values } = nodeParseArgs({
    args,
    options: {
      output: { type: 'string' },
      platform: { type: 'string' },
      arch: { type: 'string' },
    },
    strict: true,
  });

  if (!values.output || !isAbsolute(values.output)) throw new Error('--output must be an absolute path');
  if (!values.platform) throw new Error('missing --platform');
  if (!values.arch) throw new Error('missing --arch');

  return { output: values.output, platform: values.platform, arch: values.arch };
}

if (!process.env['VITEST']) {
  const { output, platform, arch } = parseArgs(process.argv.slice(2));
  getLatestVersion()
    .then(version => downloadKdn(version, platform, arch, output))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
