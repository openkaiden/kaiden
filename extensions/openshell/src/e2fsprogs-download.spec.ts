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

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { HomebrewRelocator } from './darwin-relocate';
import { downloadMkfsExt4 } from './e2fsprogs-download';

vi.mock(import('./darwin-relocate'));

const VERSION = '1.47.4';
const GETTEXT_VERSION = '1.0';
const LINUX_LIBRARIES = ['libcom_err.so.2', 'libe2p.so.2', 'libext2fs.so.2', 'libss.so.2'];
const DARWIN_DYLIB_STEMS = ['libblkid', 'libcom_err', 'libe2p', 'libext2fs', 'libss', 'libuuid'];

let testDir: string;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(HomebrewRelocator.prototype.relocate).mockResolvedValue(true);
  testDir = await mkdtemp(join(tmpdir(), 'e2fsprogs-download-test-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(testDir, { recursive: true, force: true });
});

async function createLinuxBottle(): Promise<Buffer> {
  const bottleRoot = join(testDir, 'fixture-linux', 'e2fsprogs', VERSION);
  await Promise.all([
    mkdir(join(bottleRoot, 'sbin'), { recursive: true }),
    mkdir(join(bottleRoot, 'lib'), { recursive: true }),
    mkdir(join(bottleRoot, '.bottle', 'etc'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(bottleRoot, 'sbin', 'mke2fs'), 'mke2fs-binary'),
    writeFile(join(bottleRoot, 'sbin', 'debugfs'), 'debugfs-binary'),
    writeFile(join(bottleRoot, 'sbin', 'e2fsck'), 'e2fsck-binary'),
    writeFile(join(bottleRoot, '.bottle', 'etc', 'mke2fs.conf'), '[defaults]\n'),
    writeFile(join(bottleRoot, 'NOTICE'), 'license notice'),
    writeFile(join(bottleRoot, 'README'), 'readme'),
    writeFile(join(bottleRoot, 'sbom.spdx.json'), '{}'),
    ...LINUX_LIBRARIES.map(library => writeFile(join(bottleRoot, 'lib', `${library}.1`), library)),
  ]);
  await Promise.all(LINUX_LIBRARIES.map(library => symlink(`${library}.1`, join(bottleRoot, 'lib', library))));

  const archive = join(testDir, 'linux-bottle.tar.gz');
  await tar.create({ file: archive, gzip: true, cwd: join(testDir, 'fixture-linux') }, ['e2fsprogs']);
  return readFile(archive);
}

async function createDarwinBottle(): Promise<Buffer> {
  const bottleRoot = join(testDir, 'fixture-darwin', 'e2fsprogs', VERSION);
  await Promise.all([
    mkdir(join(bottleRoot, 'sbin'), { recursive: true }),
    mkdir(join(bottleRoot, 'lib'), { recursive: true }),
    mkdir(join(bottleRoot, '.bottle', 'etc'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(bottleRoot, 'sbin', 'mke2fs'), 'mke2fs-binary'),
    writeFile(join(bottleRoot, 'sbin', 'debugfs'), 'debugfs-binary'),
    writeFile(join(bottleRoot, 'sbin', 'e2fsck'), 'e2fsck-binary'),
    writeFile(join(bottleRoot, '.bottle', 'etc', 'mke2fs.conf'), '[defaults]\n'),
    writeFile(join(bottleRoot, 'NOTICE'), 'license notice'),
    writeFile(join(bottleRoot, 'README'), 'readme'),
    ...DARWIN_DYLIB_STEMS.map(stem => writeFile(join(bottleRoot, 'lib', `${stem}.1.1.dylib`), `${stem}-versioned`)),
    ...DARWIN_DYLIB_STEMS.map(stem => writeFile(join(bottleRoot, 'lib', `${stem}.dylib`), `${stem}-unversioned`)),
  ]);

  const archive = join(testDir, 'darwin-bottle.tar.gz');
  await tar.create({ file: archive, gzip: true, cwd: join(testDir, 'fixture-darwin') }, ['e2fsprogs']);
  return readFile(archive);
}

async function createGettextBottle(): Promise<Buffer> {
  const bottleRoot = join(testDir, 'fixture-gettext', 'gettext', GETTEXT_VERSION);
  await mkdir(join(bottleRoot, 'lib'), { recursive: true });
  await Promise.all([
    writeFile(join(bottleRoot, 'lib', 'libintl.8.dylib'), 'libintl-binary'),
    writeFile(join(bottleRoot, 'lib', 'libintl.dylib'), 'libintl-unversioned'),
  ]);

  const archive = join(testDir, 'gettext-bottle.tar.gz');
  await tar.create({ file: archive, gzip: true, cwd: join(testDir, 'fixture-gettext') }, ['gettext']);
  return readFile(archive);
}

function stubLinuxRegistry(bottle: Buffer, architecture = 'amd64'): ReturnType<typeof vi.fn> {
  const digest = createHash('sha256').update(bottle).digest('hex');
  const bottleArchitecture = architecture === 'amd64' ? 'x86_64' : 'aarch64';
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/token?')) {
      return Response.json({ token: 'registry-token' });
    }
    if (url.includes('/e2fsprogs/manifests/') && url.endsWith(`/manifests/${VERSION}`)) {
      return Response.json({
        manifests: [
          {
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            digest: 'sha256:platform',
            platform: { os: 'linux', architecture },
          },
        ],
      });
    }
    if (url.endsWith('/manifests/sha256:platform')) {
      return Response.json({
        layers: [
          {
            mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
            digest: `sha256:${digest}`,
            annotations: {
              'org.opencontainers.image.title': `e2fsprogs--${VERSION}.${bottleArchitecture}_linux.bottle.tar.gz`,
            },
          },
        ],
      });
    }
    if (url.endsWith(`/blobs/sha256:${digest}`)) {
      return new Response(bottle);
    }
    return new Response('unexpected URL', { status: 404, statusText: 'Not Found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

interface DarwinFixtures {
  e2fsprogs: Buffer;
  gettext: Buffer;
}

function stubDarwinRegistry(fixtures: DarwinFixtures): ReturnType<typeof vi.fn> {
  const e2fsprogsDigest = createHash('sha256').update(fixtures.e2fsprogs).digest('hex');
  const gettextDigest = createHash('sha256').update(fixtures.gettext).digest('hex');

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes('/token?')) {
      return Response.json({ token: 'registry-token' });
    }

    if (url.includes('/e2fsprogs/manifests/') && url.endsWith(`/manifests/${VERSION}`)) {
      return Response.json({
        manifests: [
          {
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            digest: 'sha256:e2fs-platform',
            platform: { os: 'darwin', architecture: 'arm64' },
          },
        ],
      });
    }
    if (url.endsWith('/manifests/sha256:e2fs-platform')) {
      return Response.json({
        layers: [
          {
            mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
            digest: `sha256:${e2fsprogsDigest}`,
            annotations: {
              'org.opencontainers.image.title': `e2fsprogs--${VERSION}.arm64_sequoia.bottle.tar.gz`,
            },
          },
        ],
      });
    }
    if (url.endsWith(`/blobs/sha256:${e2fsprogsDigest}`)) {
      return new Response(fixtures.e2fsprogs);
    }

    if (url.includes('/gettext/manifests/') && url.endsWith(`/manifests/${GETTEXT_VERSION}`)) {
      return Response.json({
        manifests: [
          {
            mediaType: 'application/vnd.oci.image.manifest.v1+json',
            digest: 'sha256:gettext-platform',
            platform: { os: 'darwin', architecture: 'arm64' },
          },
        ],
      });
    }
    if (url.endsWith('/manifests/sha256:gettext-platform')) {
      return Response.json({
        layers: [
          {
            mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
            digest: `sha256:${gettextDigest}`,
            annotations: {
              'org.opencontainers.image.title': `gettext--${GETTEXT_VERSION}.arm64_sequoia.bottle.tar.gz`,
            },
          },
        ],
      });
    }
    if (url.endsWith(`/blobs/sha256:${gettextDigest}`)) {
      return new Response(fixtures.gettext);
    }

    return new Response('unexpected URL', { status: 404, statusText: 'Not Found' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function createDarwinFixtures(): Promise<DarwinFixtures> {
  const [e2fsprogs, gettext] = await Promise.all([createDarwinBottle(), createGettextBottle()]);
  return { e2fsprogs, gettext };
}

describe('linux', () => {
  test('downloads and stages the e2fsprogs tools beside the VM driver', async () => {
    const bottle = await createLinuxBottle();
    const fetchMock = stubLinuxRegistry(bottle);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'openshell-driver-vm'), 'vm-driver');

    await downloadMkfsExt4(VERSION, 'x64', 'linux', outputDir);

    expect(await readFile(join(outputDir, 'openshell-driver-vm'), 'utf-8')).toBe('vm-driver');
    expect(await readFile(join(outputDir, 'e2fsprogs', 'mke2fs'), 'utf-8')).toBe('mke2fs-binary');
    expect(await readFile(join(outputDir, 'e2fsprogs', 'debugfs'), 'utf-8')).toBe('debugfs-binary');
    expect(await readFile(join(outputDir, 'e2fsprogs', 'e2fsck'), 'utf-8')).toBe('e2fsck-binary');
    expect(await readFile(join(outputDir, 'e2fsprogs', 'NOTICE'), 'utf-8')).toBe('license notice');
    for (const library of LINUX_LIBRARIES) {
      expect(await readFile(join(outputDir, 'e2fsprogs', 'lib', library), 'utf-8')).toBe(library);
    }
    expect(await readFile(join(outputDir, 'e2fsprogs', 'mke2fs.conf'), 'utf-8')).toBe('[defaults]\n');
    expect(await readFile(join(outputDir, '.mkfs-ext4-version'), 'utf-8')).toBe(`${VERSION}-linux-x64`);
    if (process.platform !== 'win32') {
      expect((await stat(join(outputDir, 'mkfs.ext4'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, 'debugfs'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, 'e2fsck'))).mode & 0o111).not.toBe(0);
    }
    expect(await readFile(join(outputDir, 'mkfs.ext4'), 'utf-8')).toContain('--argv0 "mkfs.ext4"');
    expect(await readFile(join(outputDir, 'mkfs.ext4'), 'utf-8')).toContain('runtime_dir="$bin_dir/e2fsprogs"');
    expect(await readFile(join(outputDir, 'mkfs.ext4'), 'utf-8')).toContain(
      `export LD_LIBRARY_PATH="$runtime_dir/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"`,
    );
    expect(await readFile(join(outputDir, 'mkfs.ext4'), 'utf-8')).toContain(
      'mkfs.ext4 requires the glibc loader at $loader',
    );
    expect(await readFile(join(outputDir, 'debugfs'), 'utf-8')).toContain('--argv0 "debugfs"');
    expect(await readFile(join(outputDir, 'e2fsck'), 'utf-8')).toContain('--argv0 "e2fsck"');
    expect(timeoutSpy.mock.calls).toEqual([[30_000], [30_000], [30_000], [5 * 60_000]]);

    const callsAfterDownload = fetchMock.mock.calls.length;
    await downloadMkfsExt4(VERSION, 'x64', 'linux', outputDir);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDownload);

    await chmod(join(outputDir, 'e2fsprogs', 'lib', 'libext2fs.so.2'), 0o444);
    await rm(join(outputDir, 'e2fsprogs', 'mke2fs'));
    await downloadMkfsExt4(VERSION, 'x64', 'linux', outputDir);
    expect(await readFile(join(outputDir, 'e2fsprogs', 'mke2fs'), 'utf-8')).toBe('mke2fs-binary');
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDownload * 2);
  });

  test('uses the arm64 ELF loader in the launcher', async () => {
    const bottle = await createLinuxBottle();
    stubLinuxRegistry(bottle, 'arm64');
    const outputDir = join(testDir, 'output');

    await downloadMkfsExt4(VERSION, 'arm64', 'linux', outputDir);

    expect(await readFile(join(outputDir, 'mkfs.ext4'), 'utf-8')).toContain('/lib/ld-linux-aarch64.so.1');
  });
});

describe('darwin', () => {
  test('downloads and stages e2fsprogs tools and gettext for macOS beside the VM driver', async () => {
    const fixtures = await createDarwinFixtures();
    let libintlStagedBeforeRelocation = false;
    vi.mocked(HomebrewRelocator.prototype.relocate).mockImplementation(async runtimeDir => {
      libintlStagedBeforeRelocation = existsSync(join(runtimeDir, 'lib', 'libintl.8.dylib'));
      return true;
    });
    stubDarwinRegistry(fixtures);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'openshell-driver-vm'), 'vm-driver');

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);

    expect(await readFile(join(outputDir, 'openshell-driver-vm'), 'utf-8')).toBe('vm-driver');
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'mke2fs'), 'utf-8')).toBe('mke2fs-binary');
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'debugfs'), 'utf-8')).toBe('debugfs-binary');
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'e2fsck'), 'utf-8')).toBe('e2fsck-binary');
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'mke2fs.conf'), 'utf-8')).toBe('[defaults]\n');
    expect(await readFile(join(outputDir, '.mkfs-ext4-version'), 'utf-8')).toBe(`${VERSION}-darwin-arm64-relocated`);

    for (const stem of DARWIN_DYLIB_STEMS) {
      expect(await readFile(join(outputDir, '.mkfs-ext4', 'lib', `${stem}.1.1.dylib`), 'utf-8')).toBe(
        `${stem}-versioned`,
      );
      expect(await readFile(join(outputDir, '.mkfs-ext4', 'lib', `${stem}.dylib`), 'utf-8')).toBe(
        `${stem}-unversioned`,
      );
    }

    expect(await readFile(join(outputDir, '.mkfs-ext4', 'lib', 'libintl.8.dylib'), 'utf-8')).toBe('libintl-binary');
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'lib', 'libintl.dylib'), 'utf-8')).toBe('libintl-unversioned');

    if (process.platform !== 'win32') {
      expect((await stat(join(outputDir, 'mkfs.ext4'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, 'debugfs'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, 'e2fsck'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, '.mkfs-ext4', 'mke2fs'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, '.mkfs-ext4', 'debugfs'))).mode & 0o111).not.toBe(0);
      expect((await stat(join(outputDir, '.mkfs-ext4', 'e2fsck'))).mode & 0o111).not.toBe(0);

      const symlinkTarget = await readlink(join(outputDir, '.mkfs-ext4', 'mkfs.ext4'));
      expect(symlinkTarget).toBe('mke2fs');
    }

    const mkfsWrapper = await readFile(join(outputDir, 'mkfs.ext4'), 'utf-8');
    expect(mkfsWrapper).toContain('DYLD_LIBRARY_PATH');
    expect(mkfsWrapper).toContain('MKE2FS_CONFIG');
    expect(mkfsWrapper).toContain('$runtime_dir/mkfs.ext4');

    const debugfsWrapper = await readFile(join(outputDir, 'debugfs'), 'utf-8');
    expect(debugfsWrapper).toContain('DYLD_LIBRARY_PATH');
    expect(debugfsWrapper).toContain('$runtime_dir/debugfs');

    const e2fsckWrapper = await readFile(join(outputDir, 'e2fsck'), 'utf-8');
    expect(e2fsckWrapper).toContain('DYLD_LIBRARY_PATH');
    expect(e2fsckWrapper).toContain('$runtime_dir/e2fsck');

    expect(await readFile(join(outputDir, '.mkfs-ext4', 'NOTICE'), 'utf-8')).toBe('license notice');
    await expect(stat(join(outputDir, 'NOTICE'))).rejects.toThrow();
    await expect(stat(join(outputDir, 'README'))).rejects.toThrow();

    const timeoutValues = timeoutSpy.mock.calls.map(call => call[0]);
    expect(timeoutValues.filter(v => v === 30_000).length).toBeGreaterThanOrEqual(6);
    expect(timeoutValues.filter(v => v === 5 * 60_000).length).toBe(2);
    expect(HomebrewRelocator.prototype.relocate).toHaveBeenCalledExactlyOnceWith(join(outputDir, '.mkfs-ext4'));
    expect(libintlStagedBeforeRelocation).toBe(true);
  });

  test('re-downloads a cached installation staged before relocation', async () => {
    const fixtures = await createDarwinFixtures();
    const fetchMock = stubDarwinRegistry(fixtures);
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    const callsAfterDownload = fetchMock.mock.calls.length;
    await writeFile(join(outputDir, '.mkfs-ext4-version'), `${VERSION}-darwin-arm64`);

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);

    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDownload * 2);
    expect(HomebrewRelocator.prototype.relocate).toHaveBeenCalledTimes(2);
    expect(await readFile(join(outputDir, '.mkfs-ext4-version'), 'utf-8')).toBe(`${VERSION}-darwin-arm64-relocated`);
  });

  test('does not mark the installation relocated when relocation is skipped', async () => {
    const fixtures = await createDarwinFixtures();
    const fetchMock = stubDarwinRegistry(fixtures);
    vi.mocked(HomebrewRelocator.prototype.relocate).mockResolvedValue(false);
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    const callsAfterDownload = fetchMock.mock.calls.length;
    expect(await readFile(join(outputDir, '.mkfs-ext4-version'), 'utf-8')).toBe(`${VERSION}-darwin-arm64`);

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDownload * 2);
  });

  test('cleans up the installation when relocation fails', async () => {
    const fixtures = await createDarwinFixtures();
    stubDarwinRegistry(fixtures);
    vi.mocked(HomebrewRelocator.prototype.relocate).mockRejectedValue(new Error('relocation failed'));
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);

    await expect(downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir)).rejects.toThrow('relocation failed');

    expect(existsSync(join(outputDir, 'mkfs.ext4'))).toBe(false);
    expect(existsSync(join(outputDir, 'debugfs'))).toBe(false);
    expect(existsSync(join(outputDir, 'e2fsck'))).toBe(false);
    expect(existsSync(join(outputDir, '.mkfs-ext4'))).toBe(false);
    expect(existsSync(join(outputDir, '.mkfs-ext4-version'))).toBe(false);
  });

  test('reuses a complete cached installation', async () => {
    const fixtures = await createDarwinFixtures();
    const fetchMock = stubDarwinRegistry(fixtures);
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    const callsAfterDownload = fetchMock.mock.calls.length;

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDownload);
  });

  test('re-downloads when installation is incomplete', async () => {
    const fixtures = await createDarwinFixtures();
    const fetchMock = stubDarwinRegistry(fixtures);
    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    const callsAfterDownload = fetchMock.mock.calls.length;

    await chmod(join(outputDir, '.mkfs-ext4', 'lib', `${DARWIN_DYLIB_STEMS[0]}.1.1.dylib`), 0o444);
    await rm(join(outputDir, 'debugfs'));

    await downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir);
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'debugfs'), 'utf-8')).toBe('debugfs-binary');
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterDownload * 2);
  });

  test('cleans up partial installation on download failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/token?')) {
          return Response.json({ token: 'registry-token' });
        }
        if (url.includes('/e2fsprogs/manifests/') && url.endsWith(`/manifests/${VERSION}`)) {
          return Response.json({
            manifests: [
              {
                mediaType: 'application/vnd.oci.image.manifest.v1+json',
                digest: 'sha256:platform',
                platform: { os: 'darwin', architecture: 'arm64' },
              },
            ],
          });
        }
        if (url.endsWith('/manifests/sha256:platform')) {
          return Response.json({
            layers: [
              {
                mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
                digest: `sha256:${'a'.repeat(64)}`,
                annotations: {
                  'org.opencontainers.image.title': `e2fsprogs--${VERSION}.arm64_sequoia.bottle.tar.gz`,
                },
              },
            ],
          });
        }
        if (url.includes('/blobs/')) {
          return new Response('not a valid archive');
        }
        return new Response('unexpected URL', { status: 404, statusText: 'Not Found' });
      }),
    );

    const outputDir = join(testDir, 'output');
    await expect(downloadMkfsExt4(VERSION, 'arm64', 'darwin', outputDir)).rejects.toThrow('checksum mismatch');

    expect(existsSync(join(outputDir, 'mkfs.ext4'))).toBe(false);
    expect(existsSync(join(outputDir, 'e2fsck'))).toBe(false);
    expect(existsSync(join(outputDir, '.mkfs-ext4'))).toBe(false);
    expect(existsSync(join(outputDir, '.mkfs-ext4-version'))).toBe(false);
  });

  test('selects correct OCI platform for x64 architecture', async () => {
    const fixtures = await createDarwinFixtures();
    const e2fsprogsDigest = createHash('sha256').update(fixtures.e2fsprogs).digest('hex');
    const gettextDigest = createHash('sha256').update(fixtures.gettext).digest('hex');

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/token?')) {
        return Response.json({ token: 'registry-token' });
      }
      if (url.includes('/e2fsprogs/manifests/') && url.endsWith(`/manifests/${VERSION}`)) {
        return Response.json({
          manifests: [
            {
              mediaType: 'application/vnd.oci.image.manifest.v1+json',
              digest: 'sha256:arm64-platform',
              platform: { os: 'darwin', architecture: 'arm64' },
            },
            {
              mediaType: 'application/vnd.oci.image.manifest.v1+json',
              digest: 'sha256:amd64-platform',
              platform: { os: 'darwin', architecture: 'amd64' },
            },
          ],
        });
      }
      if (url.endsWith('/manifests/sha256:amd64-platform')) {
        return Response.json({
          layers: [
            {
              mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
              digest: `sha256:${e2fsprogsDigest}`,
              annotations: {
                'org.opencontainers.image.title': `e2fsprogs--${VERSION}.sonoma.bottle.tar.gz`,
              },
            },
          ],
        });
      }
      if (url.endsWith(`/blobs/sha256:${e2fsprogsDigest}`)) {
        return new Response(fixtures.e2fsprogs);
      }
      if (url.includes('/gettext/manifests/') && url.endsWith(`/manifests/${GETTEXT_VERSION}`)) {
        return Response.json({
          manifests: [
            {
              mediaType: 'application/vnd.oci.image.manifest.v1+json',
              digest: 'sha256:gettext-amd64',
              platform: { os: 'darwin', architecture: 'amd64' },
            },
          ],
        });
      }
      if (url.endsWith('/manifests/sha256:gettext-amd64')) {
        return Response.json({
          layers: [
            {
              mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
              digest: `sha256:${gettextDigest}`,
              annotations: {
                'org.opencontainers.image.title': `gettext--${GETTEXT_VERSION}.sonoma.bottle.tar.gz`,
              },
            },
          ],
        });
      }
      if (url.endsWith(`/blobs/sha256:${gettextDigest}`)) {
        return new Response(fixtures.gettext);
      }
      return new Response('unexpected URL', { status: 404, statusText: 'Not Found' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const outputDir = join(testDir, 'output');
    await mkdir(outputDir);

    await downloadMkfsExt4(VERSION, 'x64', 'darwin', outputDir);

    expect(await readFile(join(outputDir, '.mkfs-ext4-version'), 'utf-8')).toBe(`${VERSION}-darwin-x64-relocated`);
    expect(await readFile(join(outputDir, '.mkfs-ext4', 'lib', 'libintl.8.dylib'), 'utf-8')).toBe('libintl-binary');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/manifests/sha256:amd64-platform'),
      expect.anything(),
    );
  });
});

test('reports registry failures with the failing endpoint', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' })),
  );

  await expect(downloadMkfsExt4(VERSION, 'x64', 'linux', join(testDir, 'output'))).rejects.toThrow(
    'failed to fetch https://ghcr.io/token',
  );
});

test('rejects unsupported architecture', async () => {
  await expect(downloadMkfsExt4(VERSION, 'x86', 'linux', join(testDir, 'output'))).rejects.toThrow(
    'unsupported e2fsprogs architecture: x86',
  );
});
