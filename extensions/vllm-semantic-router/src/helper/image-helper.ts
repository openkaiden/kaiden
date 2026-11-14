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

import type { Logger } from '@openkaiden/api';
import type Dockerode from 'dockerode';
import { injectable } from 'inversify';

@injectable()
export class ImageHelper {
  /** Pulls `image` unless it is already available, reporting the pull progress to `logger`. */
  async ensureImage(dockerode: Dockerode, image: string, logger?: Logger): Promise<void> {
    try {
      await dockerode.getImage(image).inspect();
      logger?.log(`Image ${image} is already available`);
      return;
    } catch (err: unknown) {
      if (!(err instanceof Error && 'statusCode' in err && err.statusCode === 404)) {
        console.warn(`vllm-semantic-router: failed to inspect image ${image}, pulling it`, err);
      }
    }
    await this.pullImage(dockerode, image, logger);
  }

  private async pullImage(dockerode: Dockerode, image: string, logger?: Logger): Promise<void> {
    logger?.log(`Pulling image ${image}...`);
    // progress events are emitted for every chunk: only report status changes per layer
    const layerStatuses = new Map<string, string>();
    const onProgress = (event: { id?: string; status?: string }): void => {
      if (!event.status) {
        return;
      }
      if (event.id) {
        if (layerStatuses.get(event.id) === event.status) {
          return;
        }
        layerStatuses.set(event.id, event.status);
        logger?.log(`${event.id}: ${event.status}`);
      } else {
        logger?.log(event.status);
      }
    };

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    try {
      const stream = await dockerode.pull(image);
      dockerode.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            logger?.log(`Image ${image} pulled`);
            resolve();
          }
        },
        onProgress,
      );
    } catch (err: unknown) {
      reject(err);
    }
    return promise;
  }
}
