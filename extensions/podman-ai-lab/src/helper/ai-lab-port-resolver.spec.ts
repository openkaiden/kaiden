import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { env } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AiLabPortResolver } from './ai-lab-port-resolver';

vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));
vi.mock(import('@openkaiden/api'));

const HOME = join('home', 'user');
const LEGACY_SETTINGS = join(HOME, '.local', 'share', 'containers', 'podman-desktop', 'configuration', 'settings.json');
const XDG_SETTINGS = join(HOME, '.config', 'containers', 'podman-desktop', 'settings.json');

function fileNotFound(): Error {
  return Object.assign(new Error('no such file'), { code: 'ENOENT' });
}

describe('AiLabPortResolver', () => {
  let resolver: AiLabPortResolver;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('PODMAN_DESKTOP_HOME_DIR', undefined);
    vi.stubEnv('XDG_CONFIG_HOME', undefined);
    vi.mocked(env).isLinux = false;
    vi.mocked(homedir).mockReturnValue(HOME);
    console.warn = vi.fn();

    resolver = new AiLabPortResolver();
  });

  test('should use the port set in the Podman Desktop settings', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ 'ai-lab.apiPort': 12345 }));

    await expect(resolver.getPort()).resolves.toBe(12345);
    expect(readFile).toHaveBeenCalledWith(LEGACY_SETTINGS, 'utf-8');
  });

  test('should default to 10434 when the preference is not in the settings', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ 'other.setting': true }));

    await expect(resolver.getPort()).resolves.toBe(10434);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('should default to 10434 without warning when there is no settings file', async () => {
    vi.mocked(readFile).mockRejectedValue(fileNotFound());

    await expect(resolver.getPort()).resolves.toBe(10434);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('should read the settings of the PODMAN_DESKTOP_HOME_DIR override only', async () => {
    vi.stubEnv('PODMAN_DESKTOP_HOME_DIR', join('custom', 'pd'));
    vi.mocked(env).isLinux = true;
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ 'ai-lab.apiPort': 12345 }));

    await expect(resolver.getPort()).resolves.toBe(12345);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(join('custom', 'pd', 'configuration', 'settings.json'), 'utf-8');
  });

  test('should not look for the XDG settings outside of Linux', async () => {
    vi.mocked(readFile).mockRejectedValue(fileNotFound());

    await resolver.getPort();

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).not.toHaveBeenCalledWith(XDG_SETTINGS, 'utf-8');
  });

  describe('on Linux', () => {
    beforeEach(() => {
      vi.mocked(env).isLinux = true;
    });

    test('should fall back to the XDG settings when there are no legacy settings', async () => {
      vi.mocked(readFile)
        .mockRejectedValueOnce(fileNotFound())
        .mockResolvedValueOnce(JSON.stringify({ 'ai-lab.apiPort': 12345 }));

      await expect(resolver.getPort()).resolves.toBe(12345);
      expect(readFile).toHaveBeenLastCalledWith(XDG_SETTINGS, 'utf-8');
    });

    test('should honor XDG_CONFIG_HOME', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', join('xdg', 'config'));
      vi.mocked(readFile)
        .mockRejectedValueOnce(fileNotFound())
        .mockResolvedValueOnce(JSON.stringify({ 'ai-lab.apiPort': 12345 }));

      await resolver.getPort();

      expect(readFile).toHaveBeenLastCalledWith(
        join('xdg', 'config', 'containers', 'podman-desktop', 'settings.json'),
        'utf-8',
      );
    });

    test('should prefer the legacy settings over the XDG ones', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ 'ai-lab.apiPort': 12345 }));

      await resolver.getPort();

      expect(readFile).toHaveBeenCalledTimes(1);
      expect(readFile).toHaveBeenCalledWith(LEGACY_SETTINGS, 'utf-8');
    });
  });

  describe('unusable settings', () => {
    test('should default to 10434 and warn when the settings file cannot be read', async () => {
      vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

      await expect(resolver.getPort()).resolves.toBe(10434);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(LEGACY_SETTINGS));
    });

    test('should default to 10434 and warn when the settings file is not valid JSON', async () => {
      vi.mocked(readFile).mockResolvedValue('{ not json');

      await expect(resolver.getPort()).resolves.toBe(10434);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unable to parse'));
    });

    test.each([
      '[]',
      '"text"',
      '42',
    ])('should default to 10434 and warn when the settings file contains %s instead of an object', async content => {
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(resolver.getPort()).resolves.toBe(10434);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unexpected content'));
    });

    test.each([
      -1,
      70000,
      1.5,
      '12345',
      true,
    ])('should default to 10434 and warn on the invalid port %s', async value => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ 'ai-lab.apiPort': value }));

      await expect(resolver.getPort()).resolves.toBe(10434);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('ai-lab.apiPort'));
    });

    test('should default to 10434 and warn when AI Lab uses a random port', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ 'ai-lab.apiPort': 0 }));

      await expect(resolver.getPort()).resolves.toBe(10434);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('random API port'));
    });

    test('should warn once while the problem stays the same, and again when it comes back', async () => {
      vi.mocked(readFile)
        .mockResolvedValueOnce(JSON.stringify({ 'ai-lab.apiPort': 70000 }))
        .mockResolvedValueOnce(JSON.stringify({ 'ai-lab.apiPort': 70000 }))
        .mockResolvedValueOnce(JSON.stringify({ 'ai-lab.apiPort': 12345 }))
        .mockResolvedValueOnce(JSON.stringify({ 'ai-lab.apiPort': 70000 }));

      await resolver.getPort();
      await resolver.getPort();
      expect(console.warn).toHaveBeenCalledTimes(1);

      await expect(resolver.getPort()).resolves.toBe(12345);
      await resolver.getPort();
      expect(console.warn).toHaveBeenCalledTimes(2);
    });
  });
});
