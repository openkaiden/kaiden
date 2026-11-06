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

import { create } from '@bufbuild/protobuf';
import { OpenShellClient } from '@nvidia/openshell-sdk';
import {
  DeleteProviderProfileResponseSchema,
  ImportProviderProfilesResponseSchema,
  type ListProviderProfilesResponse,
  ListProviderProfilesResponseSchema,
  type ProviderProfile,
  ProviderProfileImportItemSchema,
  ProviderProfileSchema,
} from '@nvidia/openshell-sdk/raw';
import { beforeEach, expect, test, vi } from 'vitest';

import { Certificates } from '/@/plugin/certificates.js';
import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { CommandRegistry } from '/@/plugin/command-registry.js';
import { ConfigurationRegistry } from '/@/plugin/configuration-registry.js';
import { DefaultConfiguration } from '/@/plugin/default-configuration.js';
import type { Directories } from '/@/plugin/directories.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { LockedConfiguration } from '/@/plugin/locked-configuration.js';
import { OpenshellConstants } from '/@/plugin/openshell-cli/openshell-constants.js';
import { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import { OpenshellGatewayConfig } from '/@/plugin/openshell-cli/openshell-gateway-config.js';
import { OpenshellGatewayManager } from '/@/plugin/openshell-cli/openshell-gateway-manager.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { OpenshellProfileSynchronizer } from '/@/plugin/openshell-cli/openshell-profile-synchronizer.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { OpenshellWorkspaceDefaults } from '/@/plugin/openshell-cli/openshell-workspace-defaults.js';
import { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import { Proxy } from '/@/plugin/proxy.js';
import { StatusBarRegistry } from '/@/plugin/statusbar/statusbar-registry.js';
import { NotificationRegistry } from '/@/plugin/tasks/notification-registry.js';
import { TaskManager } from '/@/plugin/tasks/task-manager.js';
import { Telemetry } from '/@/plugin/telemetry/telemetry.js';
import { Exec } from '/@/plugin/util/exec.js';
import { Properties } from '/@/plugin/util/properties.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

vi.mock(import('@nvidia/openshell-sdk'));
vi.mock(import('/@/plugin/certificates.js'));
vi.mock(import('/@/plugin/cli-tool-registry.js'));
vi.mock(import('/@/plugin/command-registry.js'));
vi.mock(import('/@/plugin/configuration-registry.js'));
vi.mock(import('/@/plugin/default-configuration.js'));
vi.mock(import('/@/plugin/locked-configuration.js'));
vi.mock(import('/@/plugin/openshell-registry.js'));
vi.mock(import('/@/plugin/proxy.js'));
vi.mock(import('/@/plugin/statusbar/statusbar-registry.js'));
vi.mock(import('/@/plugin/tasks/notification-registry.js'));
vi.mock(import('/@/plugin/tasks/task-manager.js'));
vi.mock(import('/@/plugin/telemetry/telemetry.js'));
vi.mock(import('/@/plugin/util/exec.js'));
vi.mock(import('/@/plugin/util/properties.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-config.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-manager.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-gateway-state-manager.js'));
vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));

function gateway(name: string, reachable: boolean): GatewayInfo {
  return {
    name,
    endpoint: `http://${name}:17670`,
    canStop: false,
    canStart: false,
    gatewayState: { reachable, health: reachable ? 'healthy' : 'unknown', compatible: true },
  };
}

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};
const directories = {} as Directories;
const gatewayConfig = new OpenshellGatewayConfig();
const gatewayManager = new OpenshellGatewayManager(gatewayConfig);
const defaultConfiguration = new DefaultConfiguration(directories);
const lockedConfiguration = new LockedConfiguration(directories);
const configurationRegistry = new ConfigurationRegistry(
  apiSender,
  directories,
  defaultConfiguration,
  lockedConfiguration,
);
const gatewayStateManager = new OpenshellGatewayStateManager(
  gatewayManager,
  configurationRegistry,
  new OpenshellGateway(
    new CliToolRegistry(apiSender),
    gatewayManager,
    directories,
    new Exec(new Proxy(configurationRegistry, new Certificates())),
    new NotificationRegistry(
      apiSender,
      new TaskManager(
        apiSender,
        new StatusBarRegistry(apiSender),
        new CommandRegistry(apiSender, new Telemetry(configurationRegistry, defaultConfiguration, lockedConfiguration)),
        configurationRegistry,
      ),
    ),
  ),
);
const registry = new OpenShellRegistry(apiSender, new Properties());
const sdkClientManager = new OpenshellSdkClientManager(gatewayManager, gatewayConfig);
// OpenShellClient has a private constructor and is only obtainable through the automocked connect().
const sdkClient = OpenShellClient.prototype;

let onDidUpdateGateways: Emitter<readonly GatewayInfo[]>;
let onDidRegisterProfile: Emitter<ProviderProfile>;
let onDidUnregisterProfile: Emitter<ProviderProfile>;
let synchronizer: OpenshellProfileSynchronizer;

// Mirrors the gateway state manager, whose snapshot is up to date when it notifies listeners.
function updateGateways(gateways: readonly GatewayInfo[]): void {
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue(gateways);
  onDidUpdateGateways.fire(gateways);
}

beforeEach(() => {
  vi.resetAllMocks();
  console.error = vi.fn();
  onDidUpdateGateways = new Emitter<readonly GatewayInfo[]>();
  // Automocked classes do not get instance fields, so expose the members the synchronizer uses.
  Object.defineProperty(gatewayStateManager, 'onDidUpdateGateways', {
    value: onDidUpdateGateways.event,
    configurable: true,
  });
  onDidRegisterProfile = new Emitter<ProviderProfile>();
  Object.defineProperty(registry, 'onDidRegisterProfile', { value: onDidRegisterProfile.event, configurable: true });
  onDidUnregisterProfile = new Emitter<ProviderProfile>();
  Object.defineProperty(registry, 'onDidUnregisterProfile', {
    value: onDidUnregisterProfile.event,
    configurable: true,
  });
  Object.defineProperty(sdkClient, 'raw', {
    value: { listProviderProfiles: vi.fn(), importProviderProfiles: vi.fn(), deleteProviderProfile: vi.fn() },
    configurable: true,
  });
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue([]);
  vi.mocked(registry.getProfiles).mockReturnValue([]);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue(sdkClient);
  vi.mocked(sdkClient.raw.listProviderProfiles).mockResolvedValue(
    create(ListProviderProfilesResponseSchema, { profiles: [] }),
  );
  vi.mocked(sdkClient.raw.importProviderProfiles).mockResolvedValue(
    create(ImportProviderProfilesResponseSchema, { imported: true, diagnostics: [] }),
  );
  vi.mocked(sdkClient.raw.deleteProviderProfile).mockResolvedValue(create(DeleteProviderProfileResponseSchema, {}));
  synchronizer = new OpenshellProfileSynchronizer(gatewayStateManager, registry, sdkClientManager);
  synchronizer.init();
});

test('imports missing profiles with the ownership annotation when a gateway becomes reachable', async () => {
  vi.mocked(registry.getProfiles).mockReturnValue([create(ProviderProfileSchema, { id: 'internal' })]);

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(sdkClient.raw.importProviderProfiles).toHaveBeenCalledWith({
      profiles: [
        create(ProviderProfileImportItemSchema, {
          profile: create(ProviderProfileSchema, {
            id: 'internal',
            annotations: {
              [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
            },
          }),
          source: OpenshellConstants.OWNER_ANNOTATION_VALUE,
        }),
      ],
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
  expect(sdkClientManager.getClient).toHaveBeenCalledWith('local');
  expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledWith({
    workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
  });
});

test('deletes stale owned profiles and preserves unowned gateway profiles', async () => {
  vi.mocked(sdkClient.raw.listProviderProfiles).mockResolvedValue(
    create(ListProviderProfilesResponseSchema, {
      profiles: [
        {
          id: 'stale',
          annotations: {
            [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
          },
        },
        { id: 'user-profile', annotations: {} },
      ],
    }),
  );

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(sdkClient.raw.deleteProviderProfile).toHaveBeenCalledExactlyOnceWith({
      id: 'stale',
      allowMissing: true,
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
  expect(sdkClient.raw.importProviderProfiles).not.toHaveBeenCalled();
});

test.each([
  { name: 'first seen unreachable', events: [[gateway('local', false)]], syncs: 0 },
  { name: 'first seen reachable', events: [[gateway('local', true)]], syncs: 1 },
  { name: 'reachable to reachable', events: [[gateway('local', true)], [gateway('local', true)]], syncs: 1 },
  { name: 'reachable to unreachable', events: [[gateway('local', true)], [gateway('local', false)]], syncs: 1 },
  {
    name: 'removed while unreachable then re-added reachable',
    events: [[gateway('local', false)], [], [gateway('local', true)]],
    syncs: 1,
  },
])('synchronizes profiles $syncs time(s) when $name', async ({ events, syncs }) => {
  for (const gateways of events) {
    updateGateways(gateways);
  }
  // Give any (unexpected) scheduled sync a chance to run.
  await new Promise(resolve => setImmediate(resolve));

  expect(sdkClientManager.getClient).toHaveBeenCalledTimes(syncs);
});

test('synchronizes gateways already reachable at init', async () => {
  synchronizer.dispose();
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue([gateway('local', true)]);
  synchronizer = new OpenshellProfileSynchronizer(gatewayStateManager, registry, sdkClientManager);
  synchronizer.init();

  await vi.waitFor(() => expect(sdkClientManager.getClient).toHaveBeenCalledExactlyOnceWith('local'));
});

test('imports profiles registered before the first gateway snapshot', async () => {
  const profile = create(ProviderProfileSchema, { id: 'early' });
  vi.mocked(registry.getProfiles).mockReturnValue([profile]);
  onDidRegisterProfile.fire(profile);
  expect(sdkClientManager.getClient).not.toHaveBeenCalled();

  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(sdkClient.raw.importProviderProfiles).toHaveBeenCalledWith({
      profiles: [
        create(ProviderProfileImportItemSchema, {
          profile: create(ProviderProfileSchema, {
            id: 'early',
            annotations: {
              [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
            },
          }),
          source: OpenshellConstants.OWNER_ANNOTATION_VALUE,
        }),
      ],
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
});

test('deletes stale owned profiles left from a previous session on the first gateway snapshot', async () => {
  vi.mocked(sdkClient.raw.listProviderProfiles).mockResolvedValue(
    create(ListProviderProfilesResponseSchema, {
      profiles: [
        {
          id: 'previous-session',
          annotations: {
            [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
          },
        },
      ],
    }),
  );

  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(sdkClient.raw.deleteProviderProfile).toHaveBeenCalledExactlyOnceWith({
      id: 'previous-session',
      allowMissing: true,
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
});

test('uses the gateways known at init as the reachability baseline', async () => {
  synchronizer.dispose();
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue([gateway('local', false)]);
  synchronizer = new OpenshellProfileSynchronizer(gatewayStateManager, registry, sdkClientManager);
  synchronizer.init();

  updateGateways([gateway('local', true)]);

  await vi.waitFor(() => expect(sdkClientManager.getClient).toHaveBeenCalledWith('local'));
});

test('does not block gateway update listeners while synchronizing', async () => {
  const listener = vi.fn();
  onDidUpdateGateways.event(listener);

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  expect(listener).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(sdkClientManager.getClient).toHaveBeenCalledWith('local'));
});

test('logs and swallows errors when the client cannot be obtained', async () => {
  const failure = new Error('timeout');
  vi.mocked(sdkClientManager.getClient).mockRejectedValue(failure);

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(console.error).toHaveBeenCalledWith(
      '[openshell-profile-synchronizer] failed to synchronize provider profiles on gateway local',
      failure,
    ),
  );
});

test('logs an error when the gateway rejects the profile import', async () => {
  vi.mocked(registry.getProfiles).mockReturnValue([create(ProviderProfileSchema, { id: 'internal' })]);
  vi.mocked(sdkClient.raw.importProviderProfiles).mockResolvedValue(
    create(ImportProviderProfilesResponseSchema, { imported: false, diagnostics: [] }),
  );

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(console.error).toHaveBeenCalledWith(
      '[openshell-profile-synchronizer] failed to synchronize provider profiles on gateway local',
      new Error(`OpenShell rejected provider profile import for gateway 'local' diagnostics: []`),
    ),
  );
});

test('runs successive synchronizations of a flapping gateway sequentially', async () => {
  const { promise: firstList, resolve: resolveFirstList } = Promise.withResolvers<ListProviderProfilesResponse>();
  vi.mocked(sdkClient.raw.listProviderProfiles)
    .mockReturnValueOnce(firstList)
    .mockResolvedValue(create(ListProviderProfilesResponseSchema, { profiles: [] }));

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);
  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce());
  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce();

  resolveFirstList(create(ListProviderProfilesResponseSchema, { profiles: [] }));

  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledTimes(2));
});

test('stops reacting to gateway updates once disposed', async () => {
  updateGateways([gateway('local', false)]);
  synchronizer.dispose();
  updateGateways([gateway('local', true)]);

  expect(sdkClientManager.getClient).not.toHaveBeenCalled();
});

test('imports a profile on reachable gateways when it is registered', async () => {
  const profile = create(ProviderProfileSchema, { id: 'internal' });
  updateGateways([gateway('local', true)]);
  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce());
  vi.mocked(registry.getProfiles).mockReturnValue([profile]);

  onDidRegisterProfile.fire(profile);

  await vi.waitFor(() =>
    expect(sdkClient.raw.importProviderProfiles).toHaveBeenCalledWith({
      profiles: [
        create(ProviderProfileImportItemSchema, {
          profile: create(ProviderProfileSchema, {
            id: 'internal',
            annotations: {
              [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
            },
          }),
          source: OpenshellConstants.OWNER_ANNOTATION_VALUE,
        }),
      ],
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
  expect(sdkClientManager.getClient).toHaveBeenCalledWith('local');
});

test('deletes the owned profile from reachable gateways when it is unregistered', async () => {
  updateGateways([gateway('local', true)]);
  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce());
  vi.mocked(sdkClient.raw.listProviderProfiles).mockResolvedValue(
    create(ListProviderProfilesResponseSchema, {
      profiles: [
        {
          id: 'removed',
          annotations: {
            [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
          },
        },
      ],
    }),
  );

  onDidUnregisterProfile.fire(create(ProviderProfileSchema, { id: 'removed' }));

  await vi.waitFor(() =>
    expect(sdkClient.raw.deleteProviderProfile).toHaveBeenCalledExactlyOnceWith({
      id: 'removed',
      allowMissing: true,
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
});

test('imports a profile registered while the gateway is unreachable once the gateway recovers', async () => {
  const profile = create(ProviderProfileSchema, { id: 'internal' });
  updateGateways([gateway('local', false)]);
  vi.mocked(registry.getProfiles).mockReturnValue([profile]);

  onDidRegisterProfile.fire(profile);
  expect(sdkClientManager.getClient).not.toHaveBeenCalled();

  updateGateways([gateway('local', true)]);

  await vi.waitFor(() => expect(sdkClient.raw.importProviderProfiles).toHaveBeenCalledOnce());
});

test('synchronizes only reachable gateways when a profile is registered', async () => {
  updateGateways([gateway('up', true), gateway('down', false)]);
  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce());

  onDidRegisterProfile.fire(create(ProviderProfileSchema, { id: 'internal' }));

  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledTimes(2));
  expect(sdkClientManager.getClient).toHaveBeenCalledTimes(2);
  expect(sdkClientManager.getClient).not.toHaveBeenCalledWith('down');
});

test('coalesces profile registrations into at most one queued synchronization per gateway', async () => {
  const { promise: firstList, resolve: resolveFirstList } = Promise.withResolvers<ListProviderProfilesResponse>();
  vi.mocked(sdkClient.raw.listProviderProfiles)
    .mockReturnValueOnce(firstList)
    .mockResolvedValue(create(ListProviderProfilesResponseSchema, { profiles: [] }));
  updateGateways([gateway('local', true)]);

  onDidRegisterProfile.fire(create(ProviderProfileSchema, { id: 'first' }));
  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce());
  onDidRegisterProfile.fire(create(ProviderProfileSchema, { id: 'second' }));
  onDidRegisterProfile.fire(create(ProviderProfileSchema, { id: 'third' }));
  onDidUnregisterProfile.fire(create(ProviderProfileSchema, { id: 'first' }));

  resolveFirstList(create(ListProviderProfilesResponseSchema, { profiles: [] }));

  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledTimes(2));
  expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledTimes(2);
});

test('stops reacting to profile registrations once disposed', async () => {
  updateGateways([gateway('local', true)]);
  await vi.waitFor(() => expect(sdkClient.raw.listProviderProfiles).toHaveBeenCalledOnce());
  synchronizer.dispose();

  onDidRegisterProfile.fire(create(ProviderProfileSchema, { id: 'internal' }));
  onDidUnregisterProfile.fire(create(ProviderProfileSchema, { id: 'internal' }));

  expect(sdkClientManager.getClient).toHaveBeenCalledOnce();
});

test('does not import a profile whose id already exists unowned on the gateway', async () => {
  vi.mocked(registry.getProfiles).mockReturnValue([create(ProviderProfileSchema, { id: 'existing' })]);
  vi.mocked(sdkClient.raw.listProviderProfiles).mockResolvedValue(
    create(ListProviderProfilesResponseSchema, {
      profiles: [
        { id: 'existing', annotations: {} },
        {
          id: 'stale',
          annotations: {
            [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
          },
        },
      ],
    }),
  );

  updateGateways([gateway('local', false)]);
  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(sdkClient.raw.deleteProviderProfile).toHaveBeenCalledExactlyOnceWith({
      id: 'stale',
      allowMissing: true,
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    }),
  );
  expect(sdkClient.raw.importProviderProfiles).not.toHaveBeenCalled();
});

test('deletes every stale owned profile and logs each failure with its profile id', async () => {
  const failure = new Error('permission denied');
  vi.mocked(sdkClient.raw.listProviderProfiles).mockResolvedValue(
    create(ListProviderProfilesResponseSchema, {
      profiles: ['failing', 'deleted'].map(id => ({
        id,
        annotations: {
          [OpenshellConstants.OWNER_ANNOTATION_KEY]: OpenshellConstants.OWNER_ANNOTATION_VALUE,
        },
      })),
    }),
  );
  vi.mocked(sdkClient.raw.deleteProviderProfile)
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(create(DeleteProviderProfileResponseSchema, {}));

  updateGateways([gateway('local', true)]);

  await vi.waitFor(() =>
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      '[openshell-profile-synchronizer] failed to delete provider profile failing on gateway local',
      failure,
    ),
  );
  expect(sdkClient.raw.deleteProviderProfile).toHaveBeenCalledWith({
    id: 'deleted',
    allowMissing: true,
    workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
  });
});

test('synchronizes again after a failed synchronization', async () => {
  const profile = create(ProviderProfileSchema, { id: 'internal' });
  vi.mocked(sdkClientManager.getClient).mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(sdkClient);
  updateGateways([gateway('local', true)]);
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
  vi.mocked(registry.getProfiles).mockReturnValue([profile]);

  onDidRegisterProfile.fire(profile);

  await vi.waitFor(() => expect(sdkClient.raw.importProviderProfiles).toHaveBeenCalledOnce());
  expect(sdkClientManager.getClient).toHaveBeenCalledTimes(2);
});

test('synchronizes every currently reachable gateway when a profile is registered, whatever its tracked state', async () => {
  vi.mocked(gatewayStateManager.listGateways).mockReturnValue([gateway('local', true)]);

  onDidRegisterProfile.fire(create(ProviderProfileSchema, { id: 'internal' }));

  await vi.waitFor(() => expect(sdkClientManager.getClient).toHaveBeenCalledExactlyOnceWith('local'));
});
