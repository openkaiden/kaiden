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

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { IZipEntry } from 'adm-zip';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  downloadBinaries,
  getRelease,
  OPENSHELL_DOWNLOAD,
  OPENSHELL_IMAGE_BUILDER_DOWNLOAD,
  OPENSHELL_WINDOWS_GATEWAY_DOWNLOAD,
} from './openshell-download';
import { sha256 } from './sha256';

vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('node:stream/promises'));
vi.mock('adm-zip', () => {
  const AdmZip = vi.fn();
  AdmZip.prototype.getEntries = vi.fn().mockReturnValue([]);
  AdmZip.prototype.extractEntryTo = vi.fn();
  return { default: AdmZip };
});
vi.mock(import('tar'));
vi.mock(import('./sha256'));

let fileMap: Map<string, boolean>;

function normPath(p: string): string {
  return path.posix.normalize(String(p).replace(/\\/g, '/'));
}

function stubDownloadFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        body: new PassThrough(),
      }),
    ),
  );
}

function stubOpenShellExtraction(): void {
  vi.mocked(tar.extract).mockImplementation(async (opts: { cwd?: string; file?: string }) => {
    const cwd = opts.cwd ?? '';
    const archive = path.basename(opts.file ?? '').replace(/\.tar\.gz$/, '');
    const binaryName = archive.replace(/-(?:x86_64|aarch64)-.*/, '');
    fileMap.set(normPath(path.join(cwd, binaryName)), true);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  fileMap = new Map();
  vi.mocked(existsSync).mockImplementation(p => fileMap.get(normPath(String(p))) ?? false);
  vi.mocked(sha256).mockResolvedValue('abc123');
  vi.mocked(rename).mockImplementation(async (_oldPath, newPath) => {
    fileMap.set(normPath(String(newPath)), true);
  });
  vi.mocked(writeFile).mockImplementation(async p => {
    fileMap.set(normPath(String(p)), true);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadBinaries', () => {
  test('skips OpenShell download when the version and all binaries are cached', async () => {
    fileMap.set('/output/.openshell-version', true);
    fileMap.set('/output/openshell', true);
    fileMap.set('/output/openshell-gateway', true);
    fileMap.set('/output/openshell-sandbox', true);
    fileMap.set('/output/openshell-driver-vm', true);
    vi.mocked(readFile).mockResolvedValue('0.0.55-linux-x64');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch should not be called when cached');
      }),
    );

    await downloadBinaries(OPENSHELL_DOWNLOAD, '0.0.55', 'linux', 'x64', '/output', new Map());
  });

  test('skips image builder download when cached', async () => {
    fileMap.set('/output/.openshell-image-builder-version', true);
    fileMap.set('/output/openshell-image-builder', true);
    vi.mocked(readFile).mockResolvedValue('0.9.0-linux-x64');

    await downloadBinaries(OPENSHELL_IMAGE_BUILDER_DOWNLOAD, '0.9.0', 'linux', 'x64', '/output', new Map());

    expect(rename).not.toHaveBeenCalled();
  });

  test('re-downloads OpenShell when a binary is missing but the version marker exists', async () => {
    fileMap.set('/output/.openshell-version', true);
    fileMap.set('/output/openshell', false);
    vi.mocked(readFile).mockResolvedValue('0.0.55-linux-x64');
    stubDownloadFetch();
    stubOpenShellExtraction();
    const digests = new Map([
      ['openshell-x86_64-unknown-linux-musl.tar.gz', 'abc123'],
      ['openshell-gateway-x86_64-unknown-linux-gnu.tar.gz', 'abc123'],
      ['openshell-sandbox-x86_64-unknown-linux-gnu.tar.gz', 'abc123'],
      ['openshell-driver-vm-x86_64-unknown-linux-gnu.tar.gz', 'abc123'],
    ]);

    await downloadBinaries(OPENSHELL_DOWNLOAD, '0.0.55', 'linux', 'x64', '/output', digests);

    expect(vi.mocked(tar.extract)).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('openshell-sandbox-x86_64-unknown-linux-gnu.tar.gz'),
      expect.any(Object),
    );
  });

  test('extracts OpenShell archives and writes its version marker', async () => {
    stubDownloadFetch();
    stubOpenShellExtraction();
    const digests = new Map([
      ['openshell-x86_64-unknown-linux-musl.tar.gz', 'abc123'],
      ['openshell-gateway-x86_64-unknown-linux-gnu.tar.gz', 'abc123'],
      ['openshell-sandbox-x86_64-unknown-linux-musl.tar.gz', 'abc123'],
      ['openshell-driver-vm-x86_64-unknown-linux-gnu.tar.gz', 'abc123'],
    ]);

    await downloadBinaries(OPENSHELL_DOWNLOAD, '0.0.55', 'linux', 'x64', '/output', digests);

    expect(vi.mocked(tar.extract)).toHaveBeenCalledTimes(4);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.openshell-version'),
      '0.0.55-linux-x64',
      expect.any(Object),
    );
    expect(chmod).toHaveBeenCalledTimes(4);
  });

  test('renames a direct image builder artifact and writes its version marker', async () => {
    stubDownloadFetch();
    const digests = new Map([['openshell-image-builder-x86_64-unknown-linux-gnu', 'abc123']]);

    await downloadBinaries(OPENSHELL_IMAGE_BUILDER_DOWNLOAD, '0.9.0', 'linux', 'x64', '/output', digests);

    expect(tar.extract).not.toHaveBeenCalled();
    expect(rename).toHaveBeenCalledWith(
      path.join('/output', 'openshell-image-builder-x86_64-unknown-linux-gnu'),
      path.join('/output', 'openshell-image-builder'),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.openshell-image-builder-version'),
      '0.9.0-linux-x64',
      expect.any(Object),
    );
    expect(chmod).toHaveBeenCalledWith(path.join('/output', 'openshell-image-builder'), 0o755);
  });

  test('throws on checksum mismatch', async () => {
    stubDownloadFetch();
    const digests = new Map([['openshell-x86_64-unknown-linux-musl.tar.gz', 'wrongchecksum']]);

    await expect(downloadBinaries(OPENSHELL_DOWNLOAD, '0.0.55', 'linux', 'x64', '/output', digests)).rejects.toThrow(
      'checksum mismatch',
    );
  });

  test('throws on unsupported target', async () => {
    await expect(downloadBinaries(OPENSHELL_DOWNLOAD, '0.0.55', 'win32', 'x64', '/output', new Map())).rejects.toThrow(
      'unsupported target',
    );
  });

  test('handles darwin-arm64 OpenShell archives', async () => {
    stubDownloadFetch();
    stubOpenShellExtraction();
    const digests = new Map([
      ['openshell-aarch64-apple-darwin.tar.gz', 'abc123'],
      ['openshell-gateway-aarch64-apple-darwin.tar.gz', 'abc123'],
      ['openshell-driver-vm-aarch64-apple-darwin.tar.gz', 'abc123'],
    ]);

    await downloadBinaries(OPENSHELL_DOWNLOAD, '0.0.55', 'darwin', 'arm64', '/output', digests);

    expect(mkdir).toHaveBeenCalledWith('/output', { recursive: true });
  });

  test('extracts Windows gateway from zip archive and skips chmod', async () => {
    stubDownloadFetch();
    const mockEntries: IZipEntry[] = [
      { isDirectory: false, entryName: 'openshell-gateway.exe' } as IZipEntry,
      { isDirectory: true, entryName: 'subdir/' } as IZipEntry,
    ];
    vi.mocked(AdmZip.prototype.getEntries).mockReturnValue(mockEntries);
    vi.mocked(AdmZip.prototype.extractEntryTo).mockImplementation((_entry: unknown, outDir: string) => {
      fileMap.set(normPath(path.join(outDir, 'openshell-gateway.exe')), true);
      return true;
    });
    const digests = new Map([['openshell-x86_64-pc-windows-msvc.zip', 'abc123']]);

    await downloadBinaries(OPENSHELL_WINDOWS_GATEWAY_DOWNLOAD, 'abc123', 'win32', 'x64', '/output', digests);

    expect(AdmZip).toHaveBeenCalled();
    expect(tar.extract).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });

  test('sends Authorization header when GITHUB_TOKEN is set', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: new PassThrough() });
    vi.stubGlobal('fetch', fetchMock);
    stubOpenShellExtraction();
    const digests = new Map([['openshell-image-builder-x86_64-unknown-linux-gnu', 'abc123']]);

    await downloadBinaries(OPENSHELL_IMAGE_BUILDER_DOWNLOAD, '0.9.0', 'linux', 'x64', '/output', digests);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    );
  });

  test('sends no Authorization header when GITHUB_TOKEN is unset', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: new PassThrough() });
    vi.stubGlobal('fetch', fetchMock);
    stubOpenShellExtraction();
    const digests = new Map([['openshell-image-builder-x86_64-unknown-linux-gnu', 'abc123']]);

    await downloadBinaries(OPENSHELL_IMAGE_BUILDER_DOWNLOAD, '0.9.0', 'linux', 'x64', '/output', digests);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.any(String) }) }),
    );
  });
});

describe('getRelease', () => {
  test('strips the tag prefix and builds the digest map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({
          tag_name: 'v0.0.55',
          assets: [
            { name: 'openshell-x86_64-unknown-linux-musl.tar.gz', digest: 'sha256:abc123' },
            { name: 'openshell-gateway-x86_64-unknown-linux-gnu.tar.gz', digest: 'sha256:def456' },
            { name: 'no-digest-asset.txt', digest: null },
          ],
        }),
      }),
    );

    const release = await getRelease(OPENSHELL_DOWNLOAD, '0.0.55');

    expect(release.version).toBe('0.0.55');
    expect(release.digests.get('openshell-x86_64-unknown-linux-musl.tar.gz')).toBe('abc123');
    expect(release.digests.get('openshell-gateway-x86_64-unknown-linux-gnu.tar.gz')).toBe('def456');
    expect(release.digests.has('no-digest-asset.txt')).toBe(false);
  });

  test('uses the configured GitHub repository', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ tag_name: 'v0.9.0', assets: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getRelease(OPENSHELL_IMAGE_BUILDER_DOWNLOAD, '0.9.0');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/openkaiden/openshell-image-builder/releases/tags/v0.9.0',
      expect.any(Object),
    );
  });

  test('uses empty tag prefix for Windows gateway config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ tag_name: 'c93b2fa7', assets: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await getRelease(OPENSHELL_WINDOWS_GATEWAY_DOWNLOAD, 'c93b2fa7');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/jeffmaury/openshell-dist/releases/tags/c93b2fa7',
      expect.any(Object),
    );
    expect(release.version).toBe('c93b2fa7');
  });

  test('throws on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }),
    );

    await expect(getRelease(OPENSHELL_DOWNLOAD, '0.0.99')).rejects.toThrow('failed to fetch openshell release v0.0.99');
  });
});
