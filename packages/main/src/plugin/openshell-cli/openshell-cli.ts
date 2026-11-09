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

import { inject, injectable } from 'inversify';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { Exec } from '/@/plugin/util/exec.js';

/**
 * Wrapper around the `openshell` CLI binary for commands that are not
 * available through the SDK.
 */
@injectable()
export class OpenshellCli {
  constructor(
    @inject(Exec)
    private readonly exec: Exec,
    @inject(CliToolRegistry)
    private readonly cliToolRegistry: CliToolRegistry,
  ) {}

  getCliPath(): string {
    const tool = this.cliToolRegistry.getCliToolInfos().find(t => t.name === 'openshell');
    if (tool?.path) {
      return tool.path;
    }
    return 'openshell';
  }

  async installSandboxSshConfig(gateway: string, sandboxName: string): Promise<void> {
    const cliPath = this.getCliPath();
    const args = ['--gateway', gateway, 'sandbox', 'ssh-config', sandboxName, '--install'];
    try {
      await this.exec.exec(cliPath, args);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`openshell sandbox ssh-config failed: ${cliPath} ${args.join(' ')} — ${detail}`);
      throw new Error(`Failed to install the SSH config for workspace "${sandboxName}": ${detail}`, { cause: err });
    }
  }
}
