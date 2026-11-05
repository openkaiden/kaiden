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
import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const ENTITLEMENTS_PLIST = resolve(__dirname, '..', 'resources', 'entitlements.openshell-driver-vm.plist');

export async function ensureHypervisorEntitlement(binaryPath: string): Promise<void> {
  if (platform() !== 'darwin') {
    return;
  }

  const { stdout } = await promisify(execFile)('/usr/bin/codesign', [
    '--display',
    '--entitlements',
    '-',
    '--xml',
    binaryPath,
  ]);
  const required = [...(await readFile(ENTITLEMENTS_PLIST, 'utf-8')).matchAll(/<key>([^<]+)<\/key>/g)].map(
    ([, key]) => key,
  );
  const actual = stdout.replace(/\s+/g, '');
  if (required.every(key => actual.includes(`<key>${key}</key><true/>`))) {
    return;
  }

  await addHypervisorEntitlement(binaryPath);
}

export async function addHypervisorEntitlement(binaryPath: string): Promise<void> {
  if (platform() !== 'darwin') {
    return;
  }

  console.log(`Adding hypervisor entitlement to ${binaryPath}`);
  await promisify(execFile)('/usr/bin/codesign', [
    '--force',
    '--sign',
    '-',
    '--entitlements',
    ENTITLEMENTS_PLIST,
    binaryPath,
  ]);
}
