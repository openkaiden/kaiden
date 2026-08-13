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

import type Dockerode from 'dockerode';
import { beforeEach, expect, test, vi } from 'vitest';

import { ImageHelper } from './image-helper';

const IMAGE = 'ghcr.io/vllm-project/semantic-router/vllm-sr:v0.3.0';

const imageInspectMock = vi.fn();
const followProgressMock = vi.fn();
const dockerodeMock = {
  getImage: vi.fn(),
  pull: vi.fn(),
  modem: { followProgress: followProgressMock },
};
const dockerode = dockerodeMock as unknown as Dockerode;
const loggerMock = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

type ProgressEvent = { id?: string; status?: string };

// makes followProgress emit the given events, then finish with the given error
function pullEmits(events: ProgressEvent[], error: Error | null = null): void {
  followProgressMock.mockImplementation(
    (_stream: unknown, onFinish: (err: Error | null) => void, onProgress: (event: ProgressEvent) => void) => {
      events.forEach(onProgress);
      onFinish(error);
    },
  );
}

let helper: ImageHelper;

beforeEach(() => {
  vi.resetAllMocks();
  dockerodeMock.getImage.mockReturnValue({ inspect: imageInspectMock });
  imageInspectMock.mockRejectedValue(Object.assign(new Error('no such image'), { statusCode: 404 }));
  dockerodeMock.pull.mockResolvedValue('stream');
  pullEmits([]);
  helper = new ImageHelper();
});

test('does not pull an image that is already available', async () => {
  imageInspectMock.mockResolvedValue({});

  await helper.ensureImage(dockerode, IMAGE, loggerMock);

  expect(dockerodeMock.getImage).toHaveBeenCalledWith(IMAGE);
  expect(dockerodeMock.pull).not.toHaveBeenCalled();
  expect(loggerMock.log).toHaveBeenCalledWith(`Image ${IMAGE} is already available`);
});

test('pulls a missing image', async () => {
  await helper.ensureImage(dockerode, IMAGE, loggerMock);

  expect(dockerodeMock.pull).toHaveBeenCalledWith(IMAGE);
  expect(loggerMock.log).toHaveBeenCalledWith(`Pulling image ${IMAGE}...`);
  expect(loggerMock.log).toHaveBeenCalledWith(`Image ${IMAGE} pulled`);
});

test('still pulls the image when inspecting it fails for another reason', async () => {
  imageInspectMock.mockRejectedValue(new Error('engine error'));

  await helper.ensureImage(dockerode, IMAGE);

  expect(dockerodeMock.pull).toHaveBeenCalledWith(IMAGE);
});

test('reports the pull progress once per layer status', async () => {
  pullEmits([
    { status: 'Pulling from vllm-project/semantic-router' },
    { id: 'layer1', status: 'Downloading' },
    { id: 'layer1', status: 'Downloading' },
    { id: 'layer1', status: 'Pull complete' },
    {},
  ]);

  await helper.ensureImage(dockerode, IMAGE, loggerMock);

  expect(loggerMock.log.mock.calls.map(c => c[0])).toEqual([
    `Pulling image ${IMAGE}...`,
    'Pulling from vllm-project/semantic-router',
    'layer1: Downloading',
    'layer1: Pull complete',
    `Image ${IMAGE} pulled`,
  ]);
});

test('rejects when the pull cannot start', async () => {
  dockerodeMock.pull.mockRejectedValue(new Error('offline'));

  await expect(helper.ensureImage(dockerode, IMAGE)).rejects.toThrow('offline');
});

test('rejects when the pull fails while downloading', async () => {
  pullEmits([{ id: 'layer1', status: 'Downloading' }], new Error('connection reset'));

  await expect(helper.ensureImage(dockerode, IMAGE, loggerMock)).rejects.toThrow('connection reset');
  expect(loggerMock.log).not.toHaveBeenCalledWith(`Image ${IMAGE} pulled`);
});
