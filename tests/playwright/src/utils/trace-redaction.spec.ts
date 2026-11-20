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

import { expect, test } from '@playwright/test';
import AdmZip from 'adm-zip';

import { MCP_SERVERS, PROVIDERS } from '/@/model/core/types';
import { redactTrace, secretValuesFromEnv } from '/@/utils/trace-redaction';

// Fake value with the shape of a real one; not a credential.
const VALUE = `sk-proj-${'FAKEvalue0123456789'.repeat(2)}`;

function trace(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(data));
  }
  return zip.toBuffer();
}

function entry(zip: Buffer | undefined, name: string): string | undefined {
  return zip ? new AdmZip(zip).readAsText(name) : undefined;
}

test.describe('trace redaction', { tag: '@smoke' }, () => {
  test('redacts secret values in trace entries', () => {
    const redacted = redactTrace(trace({ 'trace.trace': `{"env":"${VALUE}","arg":"${VALUE}"}` }), [VALUE]);

    expect(entry(redacted, 'trace.trace')).toBe('{"env":"***REDACTED***","arg":"***REDACTED***"}');
  });

  test('redacts a secret that contains another one completely', () => {
    const short = 'FAKEshortvalue01';
    const long = `${short}${'FAKElongvalue0123'.repeat(2)}`;

    const redacted = redactTrace(trace({ 'trace.trace': long }), [short, long]);

    expect(entry(redacted, 'trace.trace')).toBe('***REDACTED***');
  });

  test('returns the trace unchanged when there is nothing to redact', () => {
    const original = trace({ 'trace.trace': 'nothing secret' });

    expect(redactTrace(original, [])).toBe(original);
    expect(redactTrace(original, [VALUE])).toBe(original);
  });

  test('fails closed when a base64 copy remains', () => {
    const encoded = Buffer.from(`xy${VALUE}`).toString('base64');

    expect(redactTrace(trace({ 'trace.network': encoded }), [VALUE])).toBeUndefined();
  });

  test('fails closed when a base64url copy remains', () => {
    // A value whose base64 form contains '+' or '/' differs in base64url.
    const value = `sk-proj-${'FAKE>value?0123'.repeat(3)}`;
    const encoded = Buffer.from(`xy${value}`).toString('base64url');

    expect(redactTrace(trace({ 'trace.network': encoded }), [value])).toBeUndefined();
  });

  test('fails closed on a trace it cannot read', () => {
    expect(redactTrace(Buffer.from('not a zip'), [VALUE])).toBeUndefined();
  });

  test('secretValuesFromEnv picks only secret-like names', () => {
    const secrets = secretValuesFromEnv({
      OPENAI_API_KEY: 'a'.repeat(20),
      GITHUB_TOKEN: 'b'.repeat(20),
      PODMAN_ENABLED: 'true',
      EMPTY_API_KEY: '',
      PLACEHOLDER_TOKEN: 'x',
    });

    expect(secrets.toSorted((a, b) => a.localeCompare(b))).toEqual(['a'.repeat(20), 'b'.repeat(20)]);
  });

  test('secretValuesFromEnv names the secret-like variables it skips', () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args.join(' '));
    };
    try {
      secretValuesFromEnv({ PLACEHOLDER_TOKEN: 'x', PODMAN_ENABLED: 'true' });
    } finally {
      console.warn = warn;
    }

    expect(warnings).toEqual([expect.stringContaining('PLACEHOLDER_TOKEN')]);
  });

  test('secretValuesFromEnv covers every provider and MCP server secret', () => {
    // Variables ending in _ENABLED are feature flags; every other one holds a secret.
    const secretNames = [...Object.values(PROVIDERS), ...Object.values(MCP_SERVERS)]
      .map(config => config.envVarName)
      .filter(name => !name.endsWith('_ENABLED'));
    const env = Object.fromEntries(secretNames.map(name => [name, `value-of-${name}`]));

    expect(secretValuesFromEnv(env).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.values(env).toSorted((a, b) => a.localeCompare(b)),
    );
  });
});
