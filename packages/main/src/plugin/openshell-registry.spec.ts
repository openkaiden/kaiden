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

import type { OpenShellCLI, OpenShellGateway, ProviderConnectionStatus, ProviderProfile } from '@openkaiden/api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

import { OpenShellRegistry } from './openshell-registry.js';

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};

let registry: OpenShellRegistry;

function createGateway(overrides?: Partial<OpenShellGateway>): OpenShellGateway {
  return {
    id: 'gw-1',
    name: 'Test Gateway',
    endpoint: 'https://localhost:17670',
    status: () => 'started',
    features: { supportMount: false },
    ...overrides,
  };
}

function createCLI(overrides?: Partial<OpenShellCLI>): OpenShellCLI {
  return {
    sandbox: {
      list: vi.fn(),
      delete: vi.fn(),
      connect: vi.fn(),
      enableV2Provider: vi.fn(),
    },
    provider: {
      list: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    inference: {
      set: vi.fn(),
    },
    ...overrides,
  };
}

function createProfile(overrides?: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: 'profile-1',
    displayName: 'Test Profile',
    description: 'A test profile',
    credentials: [
      {
        name: 'api_key',
        required: true,
        description: 'API Key',
        envVars: ['API_KEY'],
      },
    ],
    ...overrides,
  } as unknown as ProviderProfile;
}

describe('OpenShellRegistry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    registry = new OpenShellRegistry(apiSender);
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('registerGateway', () => {
    test('sends openshell-registry:gateway-update event via apiSender', () => {
      registry.registerGateway(createGateway());

      expect(apiSender.send).toHaveBeenCalledWith('openshell-registry:gateway-update');
    });

    test('fires onDidRegisterGateway event with the gateway', () => {
      const listener = vi.fn();
      registry.onDidRegisterGateway(listener);

      const gateway = createGateway();
      registry.registerGateway(gateway);

      expect(listener).toHaveBeenCalledWith(gateway);
    });

    test('throws when registering duplicate gateway id', () => {
      registry.registerGateway(createGateway());

      expect(() => registry.registerGateway(createGateway())).toThrow(
        `OpenShell gateway with id 'gw-1' is already registered`,
      );
    });

    test('returns a Disposable that removes the gateway', () => {
      const disposable = registry.registerGateway(createGateway());

      expect(registry.getGateways()).toHaveLength(1);

      disposable.dispose();

      expect(registry.getGateways()).toHaveLength(0);
    });

    test('dispose sends openshell-registry:gateway-update event', () => {
      const disposable = registry.registerGateway(createGateway());

      disposable.dispose();

      expect(apiSender.send).toHaveBeenCalledTimes(2);
      expect(apiSender.send).toHaveBeenNthCalledWith(2, 'openshell-registry:gateway-update');
    });

    test('dispose fires onDidUnregisterGateway event', () => {
      const listener = vi.fn();
      registry.onDidUnregisterGateway(listener);

      const gateway = createGateway();
      const disposable = registry.registerGateway(gateway);
      disposable.dispose();

      expect(listener).toHaveBeenCalledWith(gateway);
    });
  });

  describe('getGateways', () => {
    test('returns empty array when no gateways registered', () => {
      expect(registry.getGateways()).toEqual([]);
    });

    test('returns registered gateways', () => {
      const gateway = createGateway();
      registry.registerGateway(gateway);

      const gateways = registry.getGateways();
      expect(gateways).toHaveLength(1);
      expect(gateways[0]!.id).toBe('gw-1');
    });

    test('returns multiple gateways', () => {
      registry.registerGateway(createGateway({ id: 'gw-1', name: 'Gateway 1' }));
      registry.registerGateway(createGateway({ id: 'gw-2', name: 'Gateway 2' }));

      expect(registry.getGateways()).toHaveLength(2);
    });
  });

  describe('registerCLI', () => {
    test('sends openshell-registry:cli-update event via apiSender', () => {
      registry.registerCLI(createCLI());

      expect(apiSender.send).toHaveBeenCalledWith('openshell-registry:cli-update');
    });

    test('fires onDidRegisterCLI event with the CLI', () => {
      const listener = vi.fn();
      registry.onDidRegisterCLI(listener);

      const cli = createCLI();
      registry.registerCLI(cli);

      expect(listener).toHaveBeenCalledWith(cli);
    });

    test('returns a Disposable that removes the CLI', () => {
      const disposable = registry.registerCLI(createCLI());

      expect(registry.getCLIs()).toHaveLength(1);

      disposable.dispose();

      expect(registry.getCLIs()).toHaveLength(0);
    });

    test('dispose sends openshell-registry:cli-update event', () => {
      const disposable = registry.registerCLI(createCLI());

      disposable.dispose();

      expect(apiSender.send).toHaveBeenCalledTimes(2);
      expect(apiSender.send).toHaveBeenNthCalledWith(2, 'openshell-registry:cli-update');
    });

    test('dispose fires onDidUnregisterCLI event', () => {
      const listener = vi.fn();
      registry.onDidUnregisterCLI(listener);

      const cli = createCLI();
      const disposable = registry.registerCLI(cli);
      disposable.dispose();

      expect(listener).toHaveBeenCalledWith(cli);
    });

    test('allows registering multiple CLIs', () => {
      registry.registerCLI(createCLI());
      registry.registerCLI(createCLI());

      expect(registry.getCLIs()).toHaveLength(2);
    });
  });

  describe('getCLIs', () => {
    test('returns empty array when no CLIs registered', () => {
      expect(registry.getCLIs()).toEqual([]);
    });
  });

  describe('registerProfile', () => {
    test('sends openshell-registry:profile-update event via apiSender', () => {
      registry.registerProfile(createProfile());

      expect(apiSender.send).toHaveBeenCalledWith('openshell-registry:profile-update');
    });

    test('fires onDidRegisterProfile event with the profile', () => {
      const listener = vi.fn();
      registry.onDidRegisterProfile(listener);

      const profile = createProfile();
      registry.registerProfile(profile);

      expect(listener).toHaveBeenCalledWith(profile);
    });

    test('throws when registering duplicate profile id', () => {
      registry.registerProfile(createProfile());

      expect(() => registry.registerProfile(createProfile())).toThrow(
        `OpenShell profile with id 'profile-1' is already registered`,
      );
    });

    test('returns a Disposable that removes the profile', () => {
      const disposable = registry.registerProfile(createProfile());

      expect(registry.getProfiles()).toHaveLength(1);

      disposable.dispose();

      expect(registry.getProfiles()).toHaveLength(0);
    });

    test('dispose sends openshell-registry:profile-update event', () => {
      const disposable = registry.registerProfile(createProfile());

      disposable.dispose();

      expect(apiSender.send).toHaveBeenCalledTimes(2);
      expect(apiSender.send).toHaveBeenNthCalledWith(2, 'openshell-registry:profile-update');
    });

    test('dispose fires onDidUnregisterProfile event', () => {
      const listener = vi.fn();
      registry.onDidUnregisterProfile(listener);

      const profile = createProfile();
      const disposable = registry.registerProfile(profile);
      disposable.dispose();

      expect(listener).toHaveBeenCalledWith(profile);
    });

    test('allows registering multiple profiles with different ids', () => {
      registry.registerProfile(createProfile({ id: 'profile-1' }));
      registry.registerProfile(createProfile({ id: 'profile-2' }));

      expect(registry.getProfiles()).toHaveLength(2);
    });
  });

  describe('getProfiles', () => {
    test('returns empty array when no profiles registered', () => {
      expect(registry.getProfiles()).toEqual([]);
    });

    test('returns registered profiles', () => {
      const profile = createProfile();
      registry.registerProfile(profile);

      const profiles = registry.getProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.id).toBe('profile-1');
    });
  });

  describe('gateway status polling', () => {
    let pollingRegistry: OpenShellRegistry;

    beforeEach(() => {
      vi.useFakeTimers();
      pollingRegistry = new OpenShellRegistry(apiSender);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test('fires onDidUpdateGateway when gateway status changes', () => {
      const listener = vi.fn();
      pollingRegistry.onDidUpdateGateway(listener);

      let currentStatus: ProviderConnectionStatus = 'started';
      const gateway = createGateway({ status: () => currentStatus });
      pollingRegistry.registerGateway(gateway);
      vi.mocked(apiSender.send).mockClear();

      currentStatus = 'stopped';
      vi.advanceTimersByTime(5000);

      expect(listener).toHaveBeenCalledWith(gateway);
      expect(apiSender.send).toHaveBeenCalledWith('openshell-registry:gateway-update');
    });

    test('does not fire event when status stays the same', () => {
      const listener = vi.fn();
      pollingRegistry.onDidUpdateGateway(listener);

      const gateway = createGateway({ status: () => 'started' });
      pollingRegistry.registerGateway(gateway);

      vi.advanceTimersByTime(5000);

      expect(listener).not.toHaveBeenCalled();
    });

    test('dispose stops polling', () => {
      const listener = vi.fn();
      pollingRegistry.onDidUpdateGateway(listener);

      let currentStatus: ProviderConnectionStatus = 'started';
      const gateway = createGateway({ status: () => currentStatus });
      pollingRegistry.registerGateway(gateway);
      vi.mocked(apiSender.send).mockClear();

      pollingRegistry.dispose();

      currentStatus = 'stopped';
      vi.advanceTimersByTime(5000);

      expect(listener).not.toHaveBeenCalled();
      expect(apiSender.send).not.toHaveBeenCalled();
    });

    test('does not poll disposed gateways', () => {
      const listener = vi.fn();
      pollingRegistry.onDidUpdateGateway(listener);

      let currentStatus: ProviderConnectionStatus = 'started';
      const gateway = createGateway({ status: () => currentStatus });
      const disposable = pollingRegistry.registerGateway(gateway);

      disposable.dispose();
      vi.mocked(apiSender.send).mockClear();

      currentStatus = 'stopped';
      vi.advanceTimersByTime(5000);

      expect(listener).not.toHaveBeenCalled();
      expect(apiSender.send).not.toHaveBeenCalled();
    });
  });
});
