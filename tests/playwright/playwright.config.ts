/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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
import type { PlaywrightTestConfig } from '@playwright/test';

import type { ResourceId } from './src/model/core/types';

// Locally: Assumes Ollama is not available unless OLLAMA_ENABLED is explicitly set
const ollamaAvailable = !!process.env.OLLAMA_ENABLED;
const ramaLamaAvailable = !!process.env.RAMALAMA_ENABLED;
const llmmanAvailable = !!process.env.LLMMAN_ENABLED;
const podmanAvailable = !!process.env.PODMAN_ENABLED;

if (ollamaAvailable) {
  console.log('Ollama enabled - running Ollama-Provider tests');
}

if (ramaLamaAvailable) {
  console.log('RamaLama enabled - running RamaLama-Provider tests');
}

if (llmmanAvailable) {
  console.log('llmman enabled - running llmman-Provider tests');
}

if (podmanAvailable) {
  console.log('Podman enabled - running container-dependent tests');
}

const useCompactListReporter = process.env.KAIDEN_E2E_COMPACT_REPORTER === 'true';

const config: PlaywrightTestConfig & {
  projects?: Array<{
    use?: { resource?: ResourceId };
    [key: string]: unknown;
  }>;
} = {
  testDir: './src',
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,

  workers: 1,

  reporter: [
    useCompactListReporter ? ['./src/reporters/compact-list-reporter.ts'] : ['list'],
    ['html', { outputFolder: './output/html-report' }],
    ['json', { outputFile: './output/test-results.json' }],
    ['junit', { outputFile: './output/junit-results.xml' }],
  ],

  use: {
    actionTimeout: 15_000,
  },

  preserveOutput: 'always',

  projects: [
    {
      name: 'Kaiden-App-Core',
      testMatch: ['**/*.spec.ts'],
      testIgnore: ['**/provider-specs/**/*.spec.ts'],
    },
    {
      name: 'Gemini-Provider',
      testMatch: ['**/provider-specs/*.spec.ts'],
      use: {
        resource: 'gemini',
      },
      testIgnore: process.env.GEMINI_API_KEY ? [] : ['**/*'], // Skip if GEMINI_API_KEY is not set
    },
    {
      name: 'OpenAI-Provider',
      testMatch: ['**/provider-specs/*.spec.ts'],
      use: {
        resource: 'openai',
      },
      testIgnore: process.env.OPENAI_API_KEY ? ['**/provider-specs/chat-smoke.spec.ts'] : ['**/*'],
    },
    {
      name: 'Workspace-Provider',
      testMatch: ['**/provider-specs/workspaces/*.spec.ts'],
      use: {
        // Auto-detected provider makes resourceSetup a no-op; workspace tests manage their own providers
        resource: 'ollama',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        screenshot: 'on',
      },
      testIgnore: podmanAvailable && !process.env.GITHUB_ACTIONS ? [] : ['**/*'],
    },
    {
      name: 'OpenShift-AI-Provider',
      testMatch: ['**/provider-specs/*.spec.ts'],
      use: {
        resource: 'openshift-ai',
      },
      testIgnore: ['**/*'], // Disabled until OpenShift AI resource creation is implemented
    },
    {
      name: 'Ollama-Provider',
      testMatch: ['**/provider-specs/*.spec.ts'],
      use: {
        resource: 'ollama',
      },
      testIgnore: ollamaAvailable ? [] : ['**/*'], // Skip all if Ollama is not running
    },
    {
      name: 'RamaLama-Provider',
      testMatch: ['**/provider-specs/*.spec.ts'],
      use: {
        resource: 'ramalama',
      },
      testIgnore: ramaLamaAvailable ? [] : ['**/*'], // Skip all if RamaLama is not running
    },
    {
      name: 'llmman-Provider',
      testMatch: ['**/provider-specs/*.spec.ts'],
      use: {
        resource: 'llmman',
      },
      testIgnore: llmmanAvailable ? [] : ['**/*'], // Skip all if llmman is not running
    },
    {
      name: 'Knowledge-Database',
      testMatch: ['**/provider-specs/knowledge/*.spec.ts'],
      testIgnore: podmanAvailable ? [] : ['**/*'], // Skip all if Podman is not available
    },
  ],

  outputDir: './output/test-results',
};

export default config;
