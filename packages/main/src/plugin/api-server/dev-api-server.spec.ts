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

import { app } from 'electron';
import { Container, injectable, injectFromBase } from 'inversify';
import { beforeEach, expect, test, vi } from 'vitest';

import { AgentWorkspaceManager } from '/@/plugin/agent-workspace/agent-workspace-manager.js';
import { DevApiServer } from '/@/plugin/api-server/dev-api-server.js';
import { ConfigurationRegistry } from '/@/plugin/configuration-registry.js';
import { Directories } from '/@/plugin/directories.js';
import { LegacyDirectories } from '/@/plugin/directories-legacy.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { type IConfigurationChangeEvent, IConfigurationRegistry } from '/@api/configuration/models.js';

vi.mock(import('/@/plugin/agent-workspace/agent-workspace-manager.js'));
vi.mock(import('/@/plugin/configuration-registry.js'));
vi.mock(import('/@/plugin/directories-legacy.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-state-manager.js'));

@injectable()
@injectFromBase()
class TestDevApiServer extends DevApiServer {
  get directory(): string {
    return this.portFileDirectory();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
});

test('publishes the port file in the userData directory of the dev instance', () => {
  vi.mocked(app.getPath).mockReturnValue('/checkout/.electron-user-data');
  vi.mocked(LegacyDirectories.prototype.getDataDirectory).mockReturnValue('/shared/data');
  const container = new Container();
  container.bind(Directories).toConstantValue(Object.create(LegacyDirectories.prototype));
  container.bind(AgentWorkspaceManager).toConstantValue(Object.create(AgentWorkspaceManager.prototype));
  container.bind(OpenshellGatewayStateManager).toConstantValue(Object.create(OpenshellGatewayStateManager.prototype));
  // getting the server runs its init: keep it disabled, only the directory matters here
  vi.mocked(ConfigurationRegistry.prototype.getConfiguration).mockReturnValue({
    get: vi.fn().mockReturnValue(false),
    has: vi.fn(),
    update: vi.fn(),
  });
  container.bind(IConfigurationRegistry).toConstantValue(
    Object.assign(Object.create(ConfigurationRegistry.prototype), {
      onDidChangeConfiguration: new Emitter<IConfigurationChangeEvent>().event,
    }),
  );
  container.bind(TestDevApiServer).toSelf();

  expect(container.get(TestDevApiServer).directory).toBe('/checkout/.electron-user-data');
  expect(app.getPath).toHaveBeenCalledWith('userData');
});
