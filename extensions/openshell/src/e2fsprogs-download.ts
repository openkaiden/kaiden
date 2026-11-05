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

import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import * as tar from 'tar';

import { sha256 } from './sha256';

const REGISTRY = 'https://ghcr.io';
const E2FSPROGS_REPOSITORY = 'homebrew/core/e2fsprogs';
const GETTEXT_REPOSITORY = 'homebrew/core/gettext';
const GETTEXT_VERSION = '1.0';
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');
const METADATA_TIMEOUT_MS = 30_000;
const BOTTLE_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

const LINUX_LIBRARIES = ['libcom_err.so.2', 'libe2p.so.2', 'libext2fs.so.2', 'libss.so.2'];
const DARWIN_LIBRARY_STEMS = ['libblkid', 'libcom_err', 'libe2p', 'libext2fs', 'libss', 'libuuid'];
const BINARIES = [
  { name: 'mkfs.ext4', payload: 'mke2fs' },
  { name: 'debugfs', payload: 'debugfs' },
];

interface OciDescriptor {
  mediaType: string;
  digest: string;
  platform?: {
    architecture: string;
    os: string;
  };
  annotations?: Record<string, string>;
}

interface OciIndex {
  manifests: OciDescriptor[];
}

interface OciManifest {
  layers: OciDescriptor[];
}

interface RegistryToken {
  token?: string;
  access_token?: string;
}

function runtimeDirectoryName(platform: string): string {
  return platform === 'linux' ? 'e2fsprogs' : '.mkfs-ext4';
}

function architectureForOci(arch: string): string {
  if (arch === 'x64') return 'amd64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`unsupported e2fsprogs architecture: ${arch}`);
}

function parseOtoolDeps(output: string): string[] {
  const deps: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^\t(\S+)\s+\(compatibility/.exec(line);
    if (match) {
      deps.push(match[1]);
    }
  }
  return deps;
}

function isRelocatablePath(depPath: string): boolean {
  return !depPath.startsWith('/usr/lib/') && !depPath.startsWith('/System/');
}

function isDarwinLibrary(path: string, bottleRoot: string): boolean {
  return DARWIN_LIBRARY_STEMS.some(stem => path.startsWith(`${bottleRoot}/lib/${stem}`) && path.endsWith('.dylib'));
}

function isRequiredBottleEntry(path: string, type: string, version: string, platform: string): boolean {
  if (type === 'Link' || type === 'SymbolicLink') {
    return false;
  }
  const bottleRoot = `e2fsprogs/${version}`;
  const requiredPaths = [
    ...BINARIES.map(binary => `${bottleRoot}/sbin/${binary.payload}`),
    `${bottleRoot}/.bottle/etc/mke2fs.conf`,
    `${bottleRoot}/NOTICE`,
  ];
  return (
    requiredPaths.some(
      requiredPath => path === requiredPath || requiredPath.startsWith(`${path.replace(/\/$/, '')}/`),
    ) ||
    (platform === 'linux'
      ? LINUX_LIBRARIES.some(library => path.startsWith(`${bottleRoot}/lib/${library}.`))
      : isDarwinLibrary(path, bottleRoot))
  );
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

async function getRegistryToken(repository: string): Promise<string> {
  const query = new URLSearchParams({ service: 'ghcr.io', scope: `repository:${repository}:pull` });
  const result = await fetchJson<RegistryToken>(`${REGISTRY}/token?${query.toString()}`);
  const token = result.token ?? result.access_token;
  if (!token) {
    throw new Error(`registry response for ${repository} did not include an access token`);
  }
  return token;
}

async function getManifest<T>(repository: string, reference: string, token: string): Promise<T> {
  return fetchJson<T>(`${REGISTRY}/v2/${repository}/manifests/${reference}`, {
    Authorization: `Bearer ${token}`,
    Accept: MANIFEST_ACCEPT,
  });
}

async function resolveBottle(
  repository: string,
  version: string,
  arch: string,
  platform: string,
): Promise<{ digest: string; token: string }> {
  const token = await getRegistryToken(repository);
  const index = await getManifest<OciIndex>(repository, version, token);
  const ociArch = architectureForOci(arch);
  const platformManifest = index.manifests.find(
    candidate => candidate.platform?.os === platform && candidate.platform.architecture === ociArch,
  );
  if (!platformManifest) {
    throw new Error(`no ${repository} bottle for ${platform}/${arch}`);
  }
  const manifest = await getManifest<OciManifest>(repository, platformManifest.digest, token);
  const bottle = manifest.layers.find(candidate => {
    const title = candidate.annotations?.['org.opencontainers.image.title'];
    return candidate.mediaType.endsWith('+gzip') && title?.endsWith('.bottle.tar.gz');
  });
  if (!bottle) {
    throw new Error(`${repository} OCI manifest does not contain a Homebrew bottle layer`);
  }
  return { digest: bottle.digest, token };
}

async function downloadBottle(repository: string, digest: string, token: string, destination: string): Promise<void> {
  const url = `${REGISTRY}/v2/${repository}/blobs/${digest}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(BOTTLE_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ${repository} bottle: ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

async function downloadAndVerifyBottle(
  repository: string,
  version: string,
  arch: string,
  platform: string,
  outputDir: string,
): Promise<string> {
  const { digest, token } = await resolveBottle(repository, version, arch, platform);
  const expectedDigest = digest.replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    throw new Error(`invalid ${repository} bottle digest: ${digest}`);
  }
  const archive = join(outputDir, `${expectedDigest}.bottle.tar.gz`);
  try {
    await downloadBottle(repository, digest, token, archive);
    const actualDigest = await sha256(archive);
    if (actualDigest !== expectedDigest) {
      throw new Error(`checksum mismatch for ${repository} bottle: expected ${expectedDigest}, got ${actualDigest}`);
    }
  } catch (error) {
    await rm(archive, { force: true });
    throw error;
  }
  return archive;
}

function loaderForArchitecture(arch: string): string {
  if (arch === 'x64') return '/lib64/ld-linux-x86-64.so.2';
  if (arch === 'arm64') return '/lib/ld-linux-aarch64.so.1';
  throw new Error(`unsupported e2fsprogs architecture: ${arch}`);
}

function linuxWrapper(binaryName: string, payload: string, arch: string): string {
  const loader = loaderForArchitecture(arch);
  const rtDir = runtimeDirectoryName('linux');
  return `#!/bin/sh
set -eu
bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime_dir="$bin_dir/${rtDir}"
loader="${loader}"
if [ ! -x "$loader" ]; then
  echo "${binaryName} requires the glibc loader at $loader" >&2
  exit 127
fi
export LD_LIBRARY_PATH="$runtime_dir/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MKE2FS_CONFIG="\${MKE2FS_CONFIG:-$runtime_dir/mke2fs.conf}"
exec "$loader" --argv0 "${binaryName}" "$runtime_dir/${payload}" "$@"
`;
}

function darwinWrapper(binaryName: string, payload: string): string {
  const execTarget = binaryName === payload ? payload : binaryName;
  return `#!/bin/sh
set -eu
case "$0" in
  */*) script_path="$0" ;;
  *) script_path=$(command -v "$0") ;;
esac
bin_dir=$(CDPATH= cd -- "\${script_path%/*}" && pwd)
runtime_dir="$bin_dir/.mkfs-ext4"
if [ -z "\${MKE2FS_CONFIG:-}" ]; then
  export MKE2FS_CONFIG="$runtime_dir/mke2fs.conf"
fi
exec "$runtime_dir/${execTarget}" "$@"
`;
}

async function stageDarwinLibraries(bottleRoot: string, libDir: string): Promise<void> {
  const bottleLibraries = await readdir(join(bottleRoot, 'lib'));
  for (const stem of DARWIN_LIBRARY_STEMS) {
    const matchingFiles = bottleLibraries.filter(
      candidate => candidate.startsWith(stem) && candidate.endsWith('.dylib'),
    );
    if (matchingFiles.length === 0) {
      throw new Error(`e2fsprogs bottle does not contain ${stem}*.dylib`);
    }
    for (const file of matchingFiles) {
      await copyFile(join(bottleRoot, 'lib', file), join(libDir, file));
    }
  }
}

async function rewriteDarwinLibraryPaths(runtimeDir: string): Promise<void> {
  const execFileAsync = promisify(execFile);
  const libDir = join(runtimeDir, 'lib');
  const libFiles = await readdir(libDir);
  const dylibs = libFiles.filter(f => f.endsWith('.dylib'));

  for (const dylib of dylibs) {
    const dylibPath = join(libDir, dylib);
    const { stdout } = await execFileAsync('/usr/bin/otool', ['-L', dylibPath]);
    const args: string[] = ['-id', `@loader_path/${dylib}`];
    for (const dep of parseOtoolDeps(stdout)) {
      if (isRelocatablePath(dep)) {
        args.push('-change', dep, `@loader_path/${basename(dep)}`);
      }
    }
    await execFileAsync('/usr/bin/install_name_tool', [...args, dylibPath]);
  }

  for (const binary of BINARIES) {
    const binaryPath = join(runtimeDir, binary.payload);
    const { stdout } = await execFileAsync('/usr/bin/otool', ['-L', binaryPath]);
    const args: string[] = [];
    for (const dep of parseOtoolDeps(stdout)) {
      if (isRelocatablePath(dep)) {
        args.push('-change', dep, `@loader_path/lib/${basename(dep)}`);
      }
    }
    if (args.length > 0) {
      await execFileAsync('/usr/bin/install_name_tool', [...args, binaryPath]);
    }
  }
}

async function stageBottle(
  archive: string,
  version: string,
  arch: string,
  platform: string,
  outputDir: string,
): Promise<void> {
  const extractionDir = await mkdtemp(join(tmpdir(), 'kaiden-e2fsprogs-'));
  try {
    await tar.extract({
      file: archive,
      cwd: extractionDir,
      filter: (path, entry) => 'type' in entry && isRequiredBottleEntry(path, entry.type, version, platform),
    });
    const bottleRoot = join(extractionDir, 'e2fsprogs', version);
    const runtimeDir = join(outputDir, runtimeDirectoryName(platform));
    const libDir = join(runtimeDir, 'lib');
    await rm(runtimeDir, { recursive: true, force: true });
    await mkdir(libDir, { recursive: true });

    for (const binary of BINARIES) {
      const payload = join(runtimeDir, binary.payload);
      await copyFile(join(bottleRoot, 'sbin', binary.payload), payload);
      await chmod(payload, 0o755);
    }

    if (platform === 'linux') {
      const bottleLibraries = await readdir(join(bottleRoot, 'lib'));
      for (const library of LINUX_LIBRARIES) {
        const source = bottleLibraries.find(candidate => candidate.startsWith(`${library}.`));
        if (!source) {
          throw new Error(`e2fsprogs bottle does not contain ${library}`);
        }
        await copyFile(join(bottleRoot, 'lib', source), join(libDir, library));
      }
    } else {
      await stageDarwinLibraries(bottleRoot, libDir);
    }

    await copyFile(join(bottleRoot, '.bottle', 'etc', 'mke2fs.conf'), join(runtimeDir, 'mke2fs.conf'));

    await copyFile(join(bottleRoot, 'NOTICE'), join(runtimeDir, 'NOTICE'));

    if (platform === 'darwin') {
      await symlink('mke2fs', join(runtimeDir, 'mkfs.ext4'));
    }

    for (const binary of BINARIES) {
      const destination = join(outputDir, binary.name);
      const wrapperContent =
        platform === 'linux'
          ? linuxWrapper(binary.name, binary.payload, arch)
          : darwinWrapper(binary.name, binary.payload);
      await writeFile(destination, wrapperContent, { encoding: 'utf-8' });
      await chmod(destination, 0o755);
    }
  } finally {
    await rm(extractionDir, { recursive: true, force: true });
  }
}

async function stageGettextLibrary(arch: string, libDir: string): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'kaiden-gettext-'));
  try {
    console.log(`downloading gettext ${GETTEXT_VERSION} for darwin/${arch}...`);
    const archive = await downloadAndVerifyBottle(GETTEXT_REPOSITORY, GETTEXT_VERSION, arch, 'darwin', tmpDir);
    console.log('checksum verified for gettext bottle');
    const extractionDir = join(tmpDir, 'extracted');
    await mkdir(extractionDir, { recursive: true });
    await tar.extract({
      file: archive,
      cwd: extractionDir,
      filter: (path, entry) => {
        if ('type' in entry && (entry.type === 'Link' || entry.type === 'SymbolicLink')) {
          return false;
        }
        return path.startsWith(`gettext/${GETTEXT_VERSION}/lib/libintl`) && path.endsWith('.dylib');
      },
    });
    const gettextLibDir = join(extractionDir, 'gettext', GETTEXT_VERSION, 'lib');
    const gettextLibraries = await readdir(gettextLibDir);
    const intlLibs = gettextLibraries.filter(f => f.startsWith('libintl') && f.endsWith('.dylib'));
    if (intlLibs.length === 0) {
      throw new Error('gettext bottle does not contain libintl*.dylib');
    }
    for (const lib of intlLibs) {
      await copyFile(join(gettextLibDir, lib), join(libDir, lib));
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function hasCompleteInstallation(outputDir: string, platform: string): boolean {
  const rtDir = runtimeDirectoryName(platform);
  const runtimeDir = join(outputDir, rtDir);
  const paths = [
    ...BINARIES.map(binary => join(outputDir, binary.name)),
    ...BINARIES.map(binary => join(runtimeDir, binary.payload)),
    join(runtimeDir, 'mke2fs.conf'),
  ];
  paths.push(join(runtimeDir, 'NOTICE'));
  if (platform === 'linux') {
    paths.push(...LINUX_LIBRARIES.map(library => join(runtimeDir, 'lib', library)));
  } else {
    paths.push(join(runtimeDir, 'mkfs.ext4'));
    const libDir = join(runtimeDir, 'lib');
    if (!existsSync(libDir)) return false;
    try {
      const libFiles = readdirSync(libDir);
      const hasDarwinLibs = DARWIN_LIBRARY_STEMS.every(stem =>
        libFiles.some(f => f.startsWith(stem) && f.endsWith('.dylib')),
      );
      const hasIntl = libFiles.some(f => f.startsWith('libintl') && f.endsWith('.dylib'));
      if (!hasDarwinLibs || !hasIntl) return false;
    } catch {
      return false;
    }
  }
  return paths.every(path => existsSync(path));
}

export async function downloadMkfsExt4(
  version: string,
  arch: string,
  platform: string,
  outputDir: string,
): Promise<void> {
  architectureForOci(arch);

  const versionFile = join(outputDir, '.mkfs-ext4-version');
  const versionMarker = `${version}-${platform}-${arch}`;
  if (existsSync(versionFile) && hasCompleteInstallation(outputDir, platform)) {
    const existing = await readFile(versionFile, 'utf-8');
    if (existing.trim() === versionMarker) {
      console.log(`mkfs.ext4 ${version} for ${platform}/${arch} already downloaded`);
      return;
    }
  }

  await mkdir(outputDir, { recursive: true });
  try {
    console.log(`downloading mkfs.ext4 ${version} for ${platform}/${arch}...`);
    const archive = await downloadAndVerifyBottle(E2FSPROGS_REPOSITORY, version, arch, platform, outputDir);
    console.log('checksum verified for e2fsprogs bottle');
    try {
      await stageBottle(archive, version, arch, platform, outputDir);
    } finally {
      await rm(archive, { force: true });
    }
    if (platform === 'darwin') {
      const runtimeDir = join(outputDir, runtimeDirectoryName('darwin'));
      await stageGettextLibrary(arch, join(runtimeDir, 'lib'));
      await rewriteDarwinLibraryPaths(runtimeDir);
    }
    await writeFile(versionFile, versionMarker, { encoding: 'utf-8' });
  } catch (error) {
    const rtDir = runtimeDirectoryName(platform);
    await Promise.all([
      ...BINARIES.map(binary => rm(join(outputDir, binary.name), { force: true })),
      rm(join(outputDir, rtDir), { recursive: true, force: true }),
      rm(versionFile, { force: true }),
    ]);
    throw error;
  }
  console.log(`mkfs.ext4 ${version} for ${platform}/${arch} ready`);
}
