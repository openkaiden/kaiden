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

import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUTS } from '/@/model/core/types';
import { withMockedFileDialog } from '/@/utils/app-ready';

import { BasePage } from './base-page';

export class AgentSessionDetailPage extends BasePage {
  readonly flowContainer: Locator;
  readonly followUpTextarea: Locator;
  readonly sendButton: Locator;
  readonly stopButton: Locator;
  readonly attachButton: Locator;
  readonly staleSandboxBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.flowContainer = page.getByTestId('acp-session-flow');
    this.followUpTextarea = page.getByLabel('Follow-up message');
    this.sendButton = page.getByRole('button', { name: 'Send' });
    this.stopButton = page.getByRole('button', { name: 'Stop' });
    this.attachButton = page.getByRole('button', { name: 'Attach' });
    this.staleSandboxBanner = page.getByText(/no longer exists\. This session is read-only\./);
  }

  async waitForLoad(): Promise<void> {
    await expect(this.flowContainer).toBeVisible({ timeout: TIMEOUTS.STANDARD });
  }

  async sendFollowUp(text: string): Promise<void> {
    await this.followUpTextarea.fill(text);
    await expect(this.sendButton).toBeEnabled();
    await this.sendButton.click();
  }

  getPromptEvent(promptText: string): Locator {
    return this.flowContainer.getByText(promptText);
  }

  getAttachmentChip(fileName: string): Locator {
    return this.page.getByText(fileName);
  }

  async attachFile(absoluteFilePath: string, electronApp: ElectronApplication): Promise<void> {
    await withMockedFileDialog(electronApp, absoluteFilePath, async () => {
      await this.attachButton.click();
    });
  }

  getFlowText(text: string | RegExp): Locator {
    return this.flowContainer.getByText(text);
  }

  getPendingPermissionCard(): Locator {
    return this.page.getByTestId('acp-pending-permission');
  }

  getPermissionOption(namePattern: RegExp): Locator {
    return this.getPendingPermissionCard().getByRole('button', { name: namePattern });
  }

  async installTurnObserver(): Promise<void> {
    await this.page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      const prev = win.__acpTurnObserver as MutationObserver | undefined;
      if (prev) prev.disconnect();

      win.__acpTurnDone = false;
      win.__acpTurnSent = false;
      let sawStop = false;
      const observer = new MutationObserver(() => {
        const stop = document.querySelector('button[title="Stop"]');
        const send = document.querySelector('button[title="Send"]');
        if (stop) sawStop = true;
        if (sawStop && !stop && send) {
          observer.disconnect();
          win.__acpTurnObserver = undefined;
          win.__acpTurnDone = true;
        }
      });
      win.__acpTurnObserver = observer;
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  async markTurnSent(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__acpTurnSent = true;
    });
  }

  async waitForTurnCompletion(timeout: number): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const win = window as unknown as Record<string, unknown>;
        if (win.__acpTurnDone === true) return true;
        if (win.__acpTurnSent !== true) return false;
        const stop = document.querySelector('button[title="Stop"]');
        const send = document.querySelector('button[title="Send"]');
        if (!stop && send) {
          const obs = win.__acpTurnObserver as MutationObserver | undefined;
          if (obs) obs.disconnect();
          win.__acpTurnObserver = undefined;
          win.__acpTurnDone = true;
          return true;
        }
        return false;
      },
      null,
      { timeout },
    );
  }

  async installStopObserver(): Promise<void> {
    await this.page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__acpStopClicked = false;
      const observer = new MutationObserver(() => {
        const stop = document.querySelector('button[title="Stop"]') as HTMLButtonElement | null;
        if (stop && !(window as unknown as Record<string, unknown>).__acpStopClicked) {
          (window as unknown as Record<string, unknown>).__acpStopClicked = true;
          stop.click();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  async waitForStopClicked(timeout: number): Promise<void> {
    await this.page.waitForFunction(
      () => (window as unknown as Record<string, unknown>).__acpStopClicked === true,
      null,
      { timeout },
    );
  }
}
