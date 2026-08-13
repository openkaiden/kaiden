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

import { ContainerModule } from 'inversify';

import { ContainerFinder } from './container-finder';
import { EnvoyConfigGenerator } from './envoy-config-generator';
import { ImageHelper } from './image-helper';
import { MountHelper } from './mount-helper';
import { NetworkHelper } from './network-helper';
import { SemanticRouterConfigParser } from './semantic-router-config-parser';

const helpersModule = new ContainerModule(options => {
  options.bind<ContainerFinder>(ContainerFinder).toSelf().inSingletonScope();
  options.bind<NetworkHelper>(NetworkHelper).toSelf().inSingletonScope();
  options.bind<SemanticRouterConfigParser>(SemanticRouterConfigParser).toSelf().inSingletonScope();
  options.bind<EnvoyConfigGenerator>(EnvoyConfigGenerator).toSelf().inSingletonScope();
  options.bind<ImageHelper>(ImageHelper).toSelf().inSingletonScope();
  options.bind<MountHelper>(MountHelper).toSelf().inSingletonScope();
});

export { helpersModule };
