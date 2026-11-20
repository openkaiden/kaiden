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

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page, TestInfo, Video } from '@playwright/test';

import { TIMEOUTS } from '/@/model/core/types';
import { redactTrace, secretValuesFromEnv } from '/@/utils/trace-redaction';

type PendingVideo = {
  video: Video;
  videoPath: string;
  testInfo: TestInfo;
};

const pendingVideos: PendingVideo[] = [];
// Removal of private trace directories whose trace was still being written.
const pendingTraceCleanups: Promise<unknown>[] = [];

function attach(testInfo: TestInfo, name: string, path: string, contentType: string): void {
  if (existsSync(path)) {
    testInfo.attachments.push({ name, path, contentType });
  }
}

// A degraded CDP connection (e.g. after the app enters a broken state) can leave these
// calls pending forever rather than rejecting, and their own .catch() only handles
// rejection — so bound each step or a single stuck artifact stalls the whole test teardown.
// Clears its timer once either side settles, and annotates the test report (rather than just
// logging) so a degraded connection isn't silently swallowed as a routine missing artifact.
function withTimeout(promise: Promise<unknown>, label: string, testInfo: TestInfo): Promise<unknown> {
  let timer: NodeJS.Timeout;
  const timedOut = new Promise(resolve => {
    timer = setTimeout(() => {
      testInfo.annotations.push({
        type: 'warning',
        description: `${label} did not settle within ${TIMEOUTS.SHORT}ms, skipped`,
      });
      resolve(undefined);
    }, TIMEOUTS.SHORT);
  });
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

export async function saveTestArtifacts(page: Page, testInfo: TestInfo): Promise<void> {
  const context = page.context();
  const failed = testInfo.status !== testInfo.expectedStatus;

  if (!failed) {
    await withTimeout(
      context.tracing.stopChunk().catch(() => {}),
      'trace',
      testInfo,
    );
    return;
  }

  const tracePath = testInfo.outputPath('trace.zip');
  const screenshotPath = testInfo.outputPath('failure.png');
  // Video.saveAs() waits for the page or context to close before the file exists.
  // Capture the handle now and export in savePendingVideos() after Electron teardown.
  const video = page.video();
  if (video) {
    pendingVideos.push({
      video,
      videoPath: testInfo.outputPath('video.webm'),
      testInfo,
    });
  }

  // Traces record entered values, DOM snapshots and the launch environment.
  // Write the trace to a private directory and only put redacted bytes in the
  // output directory: a write that completes after the timeout stays private.
  // Without a private directory the chunk is still stopped (and discarded) so
  // the next test can start its own.
  const traceDir = await mkdtemp(join(tmpdir(), 'kaiden-trace-')).catch((error: unknown) => {
    console.error(`Failed to create a private trace directory for "${testInfo.title}":`, error);
    return undefined;
  });
  const rawTracePath = traceDir && join(traceDir, 'trace.zip');

  let traceWritten = false;
  const writingTrace = context.tracing
    .stopChunk({ path: rawTracePath })
    .catch((error: unknown) => {
      console.error('Failed to save trace:', error);
    })
    .finally(() => {
      traceWritten = true;
    });

  await Promise.all([
    withTimeout(writingTrace, 'trace', testInfo),
    withTimeout(
      page.screenshot({ path: screenshotPath, fullPage: true }).catch((error: unknown) => {
        console.error('Failed to capture failure screenshot:', error);
      }),
      'screenshot',
      testInfo,
    ),
  ]);

  if (!traceDir || !rawTracePath) {
    attach(testInfo, 'screenshot', screenshotPath, 'image/png');
    return;
  }

  try {
    // No file: stopChunk failed (logged above) or did not finish in time (annotated).
    const raw = await readFile(rawTracePath).catch((error: unknown) => {
      console.error('No trace to save:', error);
      return undefined;
    });
    const redacted = raw && redactTrace(raw, secretValuesFromEnv());
    if (redacted) {
      await writeFile(tracePath, redacted);
    } else if (raw) {
      testInfo.annotations.push({
        type: 'warning',
        description: 'trace removed: it could not be redacted',
      });
    }
  } catch (error: unknown) {
    console.error('Failed to save the redacted trace:', error);
  } finally {
    const removeTraceDir = (): Promise<void> => rm(traceDir, { recursive: true, force: true });
    if (traceWritten) {
      await removeTraceDir();
    } else {
      // Still writing after the timeout: remove it once done (awaited in savePendingVideos).
      pendingTraceCleanups.push(writingTrace.then(removeTraceDir));
    }
  }
  attach(testInfo, 'trace', tracePath, 'application/zip');
  attach(testInfo, 'screenshot', screenshotPath, 'image/png');
}

export async function savePendingVideos(): Promise<void> {
  await Promise.all(
    pendingTraceCleanups
      .splice(0, pendingTraceCleanups.length)
      .map(cleanup => cleanup.catch((error: unknown) => console.error('Failed to remove a private trace:', error))),
  );
  const queued = pendingVideos.splice(0, pendingVideos.length);
  await Promise.all(
    queued.map(async ({ video, videoPath, testInfo }) => {
      await withTimeout(
        video.saveAs(videoPath).catch(() => {}),
        'video',
        testInfo,
      );
      attach(testInfo, 'video', videoPath, 'video/webm');
    }),
  );
}
