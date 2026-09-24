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
import { inject, injectable, preDestroy } from 'inversify';

import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IDisposable } from '/@api/disposable.js';
import type { Event } from '/@api/event.js';

import { Emitter } from './events/emitter.js';
import { Disposable } from './types/disposable.js';

@injectable()
export class OpenShellRegistry implements IDisposable {
  private intervalId: NodeJS.Timeout | undefined;

  constructor(@inject(ApiSenderType) private apiSender: ApiSenderType) {
    this.startGatewayStatusPolling();
  }

  private gateways = new Map<string, OpenShellGateway>();
  private gatewayStatuses = new Map<string, ProviderConnectionStatus>();
  private clis: OpenShellCLI[] = [];
  private profiles = new Map<string, ProviderProfile>();

  private readonly _onDidRegisterGateway = new Emitter<OpenShellGateway>();
  readonly onDidRegisterGateway: Event<OpenShellGateway> = this._onDidRegisterGateway.event;

  private readonly _onDidUnregisterGateway = new Emitter<OpenShellGateway>();
  readonly onDidUnregisterGateway: Event<OpenShellGateway> = this._onDidUnregisterGateway.event;

  private readonly _onDidUpdateGateway = new Emitter<OpenShellGateway>();
  readonly onDidUpdateGateway: Event<OpenShellGateway> = this._onDidUpdateGateway.event;

  private readonly _onDidRegisterCLI = new Emitter<OpenShellCLI>();
  readonly onDidRegisterCLI: Event<OpenShellCLI> = this._onDidRegisterCLI.event;

  private readonly _onDidUnregisterCLI = new Emitter<OpenShellCLI>();
  readonly onDidUnregisterCLI: Event<OpenShellCLI> = this._onDidUnregisterCLI.event;

  private readonly _onDidRegisterProfile = new Emitter<ProviderProfile>();
  readonly onDidRegisterProfile: Event<ProviderProfile> = this._onDidRegisterProfile.event;

  private readonly _onDidUnregisterProfile = new Emitter<ProviderProfile>();
  readonly onDidUnregisterProfile: Event<ProviderProfile> = this._onDidUnregisterProfile.event;

  private readonly _onDidUpdateProfile = new Emitter<ProviderProfile>();
  readonly onDidUpdateProfile: Event<ProviderProfile> = this._onDidUpdateProfile.event;

  registerGateway(gateway: OpenShellGateway): Disposable {
    if (this.gateways.has(gateway.id)) {
      throw new Error(`OpenShell gateway with id '${gateway.id}' is already registered`);
    }

    this.gateways.set(gateway.id, gateway);
    this.gatewayStatuses.set(gateway.id, gateway.status());
    this.apiSender.send('openshell-registry:gateway-update');
    this._onDidRegisterGateway.fire(gateway);

    return Disposable.create(() => {
      this.gateways.delete(gateway.id);
      this.gatewayStatuses.delete(gateway.id);
      this.apiSender.send('openshell-registry:gateway-update');
      this._onDidUnregisterGateway.fire(gateway);
    });
  }

  registerCLI(cli: OpenShellCLI): Disposable {
    this.clis.push(cli);
    this.apiSender.send('openshell-registry:cli-update');
    this._onDidRegisterCLI.fire(cli);

    return Disposable.create(() => {
      const index = this.clis.indexOf(cli);
      if (index >= 0) {
        this.clis.splice(index, 1);
      }
      this.apiSender.send('openshell-registry:cli-update');
      this._onDidUnregisterCLI.fire(cli);
    });
  }

  registerProfile(profile: ProviderProfile): Disposable {
    if (this.profiles.has(profile.id)) {
      throw new Error(`OpenShell profile with id '${profile.id}' is already registered`);
    }

    this.profiles.set(profile.id, profile);
    this.apiSender.send('openshell-registry:profile-update');
    this._onDidRegisterProfile.fire(profile);

    return Disposable.create(() => {
      this.profiles.delete(profile.id);
      this.apiSender.send('openshell-registry:profile-update');
      this._onDidUnregisterProfile.fire(profile);
    });
  }

  getGateways(): readonly OpenShellGateway[] {
    return Array.from(this.gateways.values());
  }

  getCLIs(): readonly OpenShellCLI[] {
    return Array.from(this.clis);
  }

  getProfiles(): readonly ProviderProfile[] {
    return Array.from(this.profiles.values());
  }

  startGatewayStatusPolling(): void {
    this.intervalId = setInterval(() => {
      for (const gateway of this.gateways.values()) {
        const status = gateway.status();
        if (status !== this.gatewayStatuses.get(gateway.id)) {
          this.gatewayStatuses.set(gateway.id, status);
          this.apiSender.send('openshell-registry:gateway-update');
          this._onDidUpdateGateway.fire(gateway);
        }
      }
    }, 5000);
  }

  @preDestroy()
  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
