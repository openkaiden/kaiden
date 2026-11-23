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

import { AiLabDaemonClient } from './ai-lab-daemon-client';
import { AiLabPortResolver } from './ai-lab-port-resolver';
import { ContainerHostResolver } from './container-host-resolver';

const helpersModule = new ContainerModule(options => {
  options.bind<AiLabDaemonClient>(AiLabDaemonClient).toSelf().inSingletonScope();
  options.bind<AiLabPortResolver>(AiLabPortResolver).toSelf().inSingletonScope();
  options.bind<ContainerHostResolver>(ContainerHostResolver).toSelf().inSingletonScope();
});

export { helpersModule };
