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

import AdmZip from 'adm-zip';

const MASK = '***REDACTED***';
const SECRET_ENV_NAME = /_(API_KEY|TOKEN)$/;
// Shorter values are placeholders, not secrets, and would match unrelated bytes.
const MIN_SECRET_LENGTH = 8;

/** Secret values the tests read from their environment. */
export function secretValuesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_ENV_NAME.test(name) || !value) {
      continue;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      console.warn(`Not redacting ${name} from traces: its value is shorter than ${MIN_SECRET_LENGTH} characters`);
      continue;
    }
    secrets.push(value);
  }
  return secrets;
}

/** The value's base64 and base64url forms at each byte offset; the last 4 characters depend on what follows. */
function base64Forms(secret: string): string[] {
  return [0, 1, 2].flatMap(offset =>
    (['base64', 'base64url'] as const)
      .map(encoding => Buffer.from(secret.slice(offset)).toString(encoding).slice(0, -4))
      .filter(encoded => encoded.length >= 8),
  );
}

/**
 * Returns the trace zip with every secret value replaced by a mask, or
 * undefined if it cannot be read or a base64 copy of a value remains (fail
 * closed). Entries are handled as latin1 text, which maps every byte to one
 * character, so binary entries keep their bytes.
 */
export function redactTrace(trace: Buffer, secrets: readonly string[]): Buffer | undefined {
  if (!secrets.length) {
    return trace;
  }
  // Longest first, so a secret containing another one is replaced whole.
  const values = secrets.map(secret => Buffer.from(secret).toString('latin1')).toSorted((a, b) => b.length - a.length);
  const valueBytes = values.map(value => Buffer.from(value, 'latin1'));
  const encoded = secrets.flatMap(base64Forms);
  try {
    const zip = new AdmZip(trace);
    let changed = false;
    for (const entry of zip.getEntries()) {
      let data = entry.getData();
      // Only entries holding a value are converted and rewritten.
      if (valueBytes.some(value => data.includes(value))) {
        const redacted = values.reduce((text, value) => text.replaceAll(value, MASK), data.toString('latin1'));
        data = Buffer.from(redacted, 'latin1');
        zip.updateFile(entry, data);
        changed = true;
      }
      if (encoded.some(form => data.includes(form))) {
        console.error('Not saving the trace: a secret value remained after redaction');
        return undefined;
      }
    }
    return changed ? zip.toBuffer() : trace;
  } catch (error: unknown) {
    console.error('Not saving the trace: it could not be redacted:', error);
    return undefined;
  }
}
