/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { inject, injectable } from 'inversify';
import z from 'zod';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { Exec } from '/@/plugin/util/exec.js';
import { type GatewayInfo, GatewayInfoSchema } from '/@api/openshell-gateway-info.js';

/** Gateway discovery shared by the CLI facade and the SDK client factory. */
@injectable()
export class OpenshellGatewayDiscovery {
  constructor(
    @inject(Exec) private readonly exec: Exec,
    @inject(CliToolRegistry) private readonly cliToolRegistry: CliToolRegistry,
  ) {}

  async listGateways(): Promise<GatewayInfo[]> {
    const cliPath = this.getCliPath();
    const args = ['gateway', 'list', '-o', 'json'];
    try {
      const result = await this.exec.exec(cliPath, args);
      return z.array(GatewayInfoSchema).parse(JSON.parse(result.stdout));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`openshell failed: ${cliPath} ${args.join(' ')} — ${detail}`);
      throw new Error(detail);
    }
  }

  private getCliPath(): string {
    const tool = this.cliToolRegistry.getCliToolInfos().find(candidate => candidate.name === 'openshell');
    if (tool?.path) return tool.path;

    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
      const bundledPath = join(resourcesPath, 'openshell', 'openshell');
      if (existsSync(bundledPath)) return bundledPath;
    }
    return 'openshell';
  }
}
