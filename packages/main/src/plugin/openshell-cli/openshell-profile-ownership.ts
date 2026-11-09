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
import { type ProviderProfileImportItem, ProviderProfileImportItemSchema } from '@nvidia/openshell-sdk/raw';
import type { ProviderProfile } from '@openkaiden/api';
import { injectable } from 'inversify';

import product from '/@product.json' with { type: 'json' };

/** Marks the OpenShell provider profiles that this product imported on a gateway. */
@injectable()
export class OpenshellProfileOwnership {
  protected readonly annotationKey = `${product.appId.toLowerCase()}.owned-by`;
  protected readonly annotationValue = product.name.toLowerCase();
  protected readonly importSource = product.name.toLowerCase();

  annotate(profile: ProviderProfile): ProviderProfile {
    return {
      ...profile,
      annotations: {
        ...profile.annotations,
        [this.annotationKey]: this.annotationValue,
      },
    };
  }

  /** Builds the gateway import item for the profile, annotated as owned. */
  toImportItem(profile: ProviderProfile): ProviderProfileImportItem {
    return create(ProviderProfileImportItemSchema, { profile: this.annotate(profile), source: this.importSource });
  }

  isOwned(profile: ProviderProfile): boolean {
    return profile.annotations[this.annotationKey] === this.annotationValue;
  }
}
