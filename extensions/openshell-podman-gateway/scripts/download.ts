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

/**
 * Downloads the Linux openshell-admission-hook binaries from
 * https://github.com/openkaiden/openshell-admission-hook.
 *
 * The hook runs inside the Podman machine (a Linux VM), so for each Windows
 * target we fetch the Linux binary matching the host architecture.
 * Binaries are stored in assets/<platform>-<arch>/openshell-admission-hook.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, '..', 'assets');

const NAME = 'openshell-admission-hook';
const REPOSITORY = 'openkaiden/openshell-admission-hook';
const BINARY_NAME = 'openshell-admission-hook';

// host target (where Kaiden runs) -> Linux release asset (what runs in the Podman machine)
const TARGETS: Record<string, string> = {
  'win32-x64': 'openshell-admission-hook-linux-amd64',
  'win32-arm64': 'openshell-admission-hook-linux-arm64',
};

function githubHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = process.env['GITHUB_TOKEN'];
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function getDigests(tag: string): Promise<Map<string, string>> {
  const res = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${tag}`, {
    headers: githubHeaders({ Accept: 'application/vnd.github.v3+json' }),
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`failed to fetch ${NAME} release ${tag}: ${res.status} ${res.statusText}`);
  }
  const data: unknown = await res.json();
  const assets = data && typeof data === 'object' && 'assets' in data ? data.assets : undefined;
  if (!Array.isArray(assets)) {
    throw new Error(`unexpected response for ${NAME} release ${tag}: missing "assets" array`);
  }
  const digests = new Map<string, string>();
  for (const asset of assets as unknown[]) {
    if (!asset || typeof asset !== 'object') {
      continue;
    }
    const { name, digest } = asset as { name?: unknown; digest?: unknown };
    if (typeof name === 'string' && typeof digest === 'string' && digest) {
      digests.set(name, digest.replace(/^sha256:/, ''));
    }
  }
  return digests;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function downloadTarget(
  version: string,
  tag: string,
  target: string,
  assetName: string,
  digests: Map<string, string>,
): Promise<void> {
  const outputDir = resolve(ASSETS_DIR, target);
  const binaryPath = join(outputDir, BINARY_NAME);
  const versionFile = join(outputDir, `.${NAME}-version`);
  const versionMarker = `${version}-${target}`;

  if (existsSync(versionFile) && existsSync(binaryPath)) {
    const existing = await readFile(versionFile, { encoding: 'utf-8' });
    if (existing.trim() === versionMarker) {
      console.log(`${NAME} ${version} for ${target} already downloaded`);
      return;
    }
  }

  const expected = digests.get(assetName);
  if (!expected) {
    throw new Error(`no digest found for ${assetName} in ${NAME} release ${tag}`);
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const url = `https://github.com/${REPOSITORY}/releases/download/${tag}/${assetName}`;
  const downloadPath = join(outputDir, assetName);
  console.log(`downloading ${assetName} ${version} for ${target}...`);
  const res = await fetch(url, { headers: githubHeaders(), redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(downloadPath));

  const actual = await sha256(downloadPath);
  if (actual !== expected) {
    await rm(outputDir, { recursive: true, force: true });
    throw new Error(`checksum mismatch for ${assetName}: expected ${expected}, got ${actual}`);
  }
  console.log(`checksum verified for ${assetName}`);

  await rename(downloadPath, binaryPath);
  await chmod(binaryPath, 0o755);
  await writeFile(versionFile, versionMarker, { encoding: 'utf-8' });
  console.log(`${NAME} ${version} for ${target} ready`);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    all: { type: 'boolean', default: false },
    platform: { type: 'string' },
    arch: { type: 'string' },
  },
  strict: true,
});

let targets: string[];
if (values.all) {
  targets = Object.keys(TARGETS);
} else if (values.platform && values.arch) {
  const requested = `${values.platform}-${values.arch}`;
  if (!TARGETS[requested]) {
    console.error(`Unsupported target "${requested}". Use --all or one of: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }
  targets = [requested];
} else if (values.platform || values.arch) {
  console.error('--platform and --arch must be specified together');
  process.exit(1);
} else {
  targets = Object.keys(TARGETS).filter(target => target.startsWith(`${process.platform}-`));
}

if (targets.length === 0) {
  console.log(
    `No ${NAME} target for host platform "${process.platform}", skipping. Use --all or pass --platform and --arch to download for a specific target.`,
  );
  process.exit(0);
}

(async (): Promise<void> => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as {
    openshellAdmissionHookVersion?: string;
  };
  const version = pkg.openshellAdmissionHookVersion;
  if (!version) {
    throw new Error('missing "openshellAdmissionHookVersion" in package.json');
  }
  const tag = `v${version}`;
  const digests = await getDigests(tag);
  console.log(`${NAME} pinned release: ${tag}`);

  for (const target of targets) {
    await downloadTarget(version, tag, target, TARGETS[target], digests);
  }
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
