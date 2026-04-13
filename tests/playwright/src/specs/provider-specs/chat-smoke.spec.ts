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
import { MCP_SERVERS, TIMEOUTS } from 'src/model/core/types';

import { expect, test } from '../../fixtures/provider-fixtures';
import { waitForNavigationReady } from '../../utils/app-ready';

const hasGithubToken = !!process.env[MCP_SERVERS.github.envVarName];

test.use({
  mcpServers: process.env[MCP_SERVERS.github.envVarName] ? ['github'] : [],
});

test.beforeEach(async ({ page, navigationBar, chatPage }) => {
  await waitForNavigationReady(page);
  await navigationBar.ensureChatWindowEnabled();
  await navigationBar.navigateToChatPage();
  await chatPage.ensureChatSidebarVisible();
  const existingCount = await chatPage.getChatHistoryCount();
  if (existingCount > 0) {
    await chatPage.deleteAllChatHistoryItems();
    await chatPage.verifyChatHistoryEmpty();
    await chatPage.ensureNotificationsAreNotVisible();
  }
});

test.describe
  .serial('Chat UI elements', { tag: '@smoke' }, () => {
    test('[CHAT-UI-01] All chat UI elements are visible', async ({ chatPage }) => {
      await chatPage.verifyHeaderElementsVisible();
      await chatPage.verifyInputAreaVisible();
      await chatPage.verifySuggestedMessagesVisible();
    });
  });

test.describe
  .serial('Chat history management', { tag: '@smoke' }, () => {
    test('[CHAT-HIST-01] Create and check new chat history item', async ({ chatPage }) => {
      await chatPage.ensureChatSidebarVisible();
      const initialCount = await chatPage.getChatHistoryCount();
      await chatPage.getSuggestedMessages().last().click();
      await expect
        .poll(async () => await chatPage.getChatHistoryCount(), { timeout: TIMEOUTS.MODEL_RESPONSE })
        .toBe(initialCount + 1);
    });

    test('[CHAT-HIST-02] Create and switch between multiple chat sessions without data loss', async ({ chatPage }) => {
      test.slow();

      await chatPage.ensureChatSidebarVisible();
      let messageCount = await chatPage.getChatHistoryCount();
      if (messageCount > 0) {
        await expect(chatPage.deleteAllChatsButton).toBeVisible();
        await chatPage.deleteAllChatHistoryItems();
        await chatPage.verifyChatHistoryEmpty();
        messageCount = 0;
      }

      const chatSessions = [
        { message: 'What is Kubernetes?', expectedIndex: 1 },
        { message: 'Explain Docker containers', expectedIndex: 0 },
      ];

      for (const session of chatSessions) {
        await chatPage.clickNewChat();
        await chatPage.sendMessage(session.message);

        messageCount++;
        await expect
          .poll(async () => await chatPage.getChatHistoryCount(), { timeout: TIMEOUTS.MODEL_RESPONSE })
          .toBe(messageCount);
      }

      for (const session of chatSessions) {
        await chatPage.clickChatHistoryItemByIndex(session.expectedIndex);
        await chatPage.verifyConversationMessage(session.message);
      }
    });

    test('[CHAT-HIST-03] Delete single chat item and then delete all remaining items', async ({ chatPage }) => {
      await chatPage.ensureChatSidebarVisible();
      let initialCount = await chatPage.getChatHistoryCount();

      // Create at least 2 chats if none exist
      if (initialCount < 2) {
        for (let i = initialCount; i < 2; i++) {
          await chatPage.clickNewChat();
          const message = `Test message ${i + 1}`;
          await chatPage.sendMessage(message, { timeout: 100 });
          await chatPage.verifyConversationMessage(message);
        }
        await expect
          .poll(async () => await chatPage.getChatHistoryCount(), { timeout: TIMEOUTS.MODEL_RESPONSE })
          .toBeGreaterThanOrEqual(2);
        initialCount = await chatPage.getChatHistoryCount();
      }

      // Verify delete all button is visible when there are chats
      await expect(chatPage.deleteAllChatsButton).toBeVisible();

      await chatPage.deleteChatHistoryItemByIndex(0);
      const expectedCountAfterSingleDelete = initialCount - 1;
      await chatPage.waitForChatHistoryCount(expectedCountAfterSingleDelete);

      // Click on a chat to view it before deleting all
      if (expectedCountAfterSingleDelete > 0) {
        await chatPage.clickChatHistoryItemByIndex(0);
        // Verify we're viewing the conversation (no suggested messages)
        await expect(chatPage.suggestedMessagesGrid).not.toBeVisible();
        // Delete all button should still be visible
        await expect(chatPage.deleteAllChatsButton).toBeVisible();
      }

      await chatPage.deleteAllChatHistoryItems();
      await chatPage.verifyChatHistoryEmpty();

      // Verify the chat view resets to a fresh conversation state
      await chatPage.verifySuggestedMessagesVisible();
      await expect(chatPage.conversationMessages).toHaveCount(0);

      // Verify delete all button is no longer visible when there are no chats
      await expect(chatPage.deleteAllChatsButton).not.toBeVisible();

      await chatPage.ensureNotificationsAreNotVisible();
    });

    test('[CHAT-HIST-04] Delete all button remains visible without scrolling', async ({ chatPage }) => {
      await chatPage.ensureChatSidebarVisible();

      const expectedChats = 15;
      const initialCount = await chatPage.getChatHistoryCount();

      // Create missing chats to reach the expected count
      if (initialCount < expectedChats) {
        const chatsToCreate = expectedChats - initialCount;
        for (let i = 0; i < chatsToCreate; i++) {
          await chatPage.clickNewChat();
          await chatPage.sendMessage(`Reply "OK ${i + 1}", nothing else.`, { waitForMessage: false });
        }

        // Wait for all chats to appear in history
        await expect
          .poll(async () => await chatPage.getChatHistoryCount(), { timeout: TIMEOUTS.MODEL_RESPONSE })
          .toBeGreaterThanOrEqual(expectedChats);
      }

      // Verify delete all button is visible in viewport without scrolling
      await expect(chatPage.deleteAllChatsButton).toBeInViewport();

      // Stop any stuck generation before cleanup; test does not require model output to finish
      if (await chatPage.stopButton.isVisible()) {
        await chatPage.clickStopButton();
      }
      await chatPage.verifySendButtonVisible(TIMEOUTS.SHORT);

      // Clean up - delete all chats
      await chatPage.deleteAllChatHistoryItems();
      await chatPage.verifyChatHistoryEmpty();
      await chatPage.ensureNotificationsAreNotVisible();
    });
  });

test.describe
  .serial('Chat model selection', { tag: '@smoke' }, () => {
    test('[CHAT-MODEL-01] Switch between all available models and verify each selection', async ({ chatPage }) => {
      const chatModelNames = await chatPage.getChatModelNames();

      if (chatModelNames.length < 2) {
        test.skip(true, 'Skipping test: Less than 2 chat models available');
        return;
      }

      const modelsToTest = chatModelNames.slice(0, 3).reverse();

      for (const modelName of modelsToTest) {
        await chatPage.clickNewChat(); // Select a new chat before selecting a model

        await chatPage.selectModelByName(modelName);
        const selectedModelName = await chatPage.getSelectedModelName();
        expect(selectedModelName).toBe(modelName);

        const testMessage = `Test message for model: "${selectedModelName}"`;
        await chatPage.sendMessage(testMessage);
        await chatPage.verifyConversationMessage(testMessage);
      }
    });

    test('[CHAT-MODEL-02] Change models mid-conversation, verify conversation history is preserved', async ({
      chatPage,
    }) => {
      test.slow();

      const chatModelNames = await chatPage.getChatModelNames();

      if (chatModelNames.length < 2) {
        test.skip(true, 'Skipping test: Less than 2 chat models available');
        return;
      }

      await chatPage.ensureChatSidebarVisible();
      await chatPage.clickNewChat();
      const initialCount = await chatPage.getChatHistoryCount();

      const modelSwitches = [
        { modelName: chatModelNames[0], message: 'Hello, how are you?' },
        { modelName: chatModelNames[1], message: 'Tell me about AI models' },
      ];

      const sentMessages: string[] = [];
      const expectedCountAfterFirstMessage = initialCount + 1;

      for (const modelSwitch of modelSwitches) {
        await chatPage.selectModelByName(modelSwitch.modelName);
        const selectedModelName = await chatPage.getSelectedModelName();
        expect(selectedModelName).toBe(modelSwitch.modelName);

        await chatPage.sendMessage(modelSwitch.message);
        sentMessages.push(modelSwitch.message);

        await chatPage.waitForChatHistoryCount(expectedCountAfterFirstMessage);

        for (const message of sentMessages) {
          await chatPage.verifyConversationMessage(message);
        }
      }
    });

    test('[CHAT-MODEL-03] Last used model is remembered when starting a new chat', async ({ chatPage }) => {
      const modelCount = await chatPage.getAvailableModelsCount();

      if (modelCount < 2) {
        test.skip(true, 'Skipping test: Less than 2 models available');
        return;
      }

      // Select the second model
      await chatPage.selectModelByIndex(1);
      const selectedModelName = await chatPage.getSelectedModelName();
      expect(selectedModelName).toBeTruthy();

      // Start a new chat and verify the last used model is still selected
      await chatPage.clickNewChat();
      const modelAfterNewChat = await chatPage.getSelectedModelName();
      expect(modelAfterNewChat).toBe(selectedModelName);
    });
  });

test.describe
  .serial('Chat message editing', { tag: '@smoke' }, () => {
    test('[CHAT-EDIT-01] Edit button enters editing mode and ESC cancels it', async ({ chatPage }) => {
      test.slow();
      await chatPage.clickNewChat();
      await chatPage.verifySendButtonVisible();

      const message = 'Hello, this is a test message';
      await chatPage.sendMessage(message);
      await chatPage.waitForModelResponse();

      await chatPage.clickEditOnUserMessage(message);
      await chatPage.verifyEditingMode(message);
      await chatPage.verifyMessagesAfterEditAreDimmed(message);

      await chatPage.cancelEditing();

      await expect(chatPage.messageField).toHaveValue('');
      await chatPage.verifyConversationMessage(message);
      await chatPage.verifyMessagesAfterEditAreNotDimmed();
    });

    test('[CHAT-EDIT-02] Edit message and submit triggers regeneration', async ({ chatPage }) => {
      test.slow();
      await chatPage.clickNewChat();
      await chatPage.verifySendButtonVisible();

      const originalMessage = 'What is 2 + 2?';
      await chatPage.sendMessage(originalMessage);
      await chatPage.waitForModelResponse();

      await chatPage.clickEditOnUserMessage(originalMessage);
      await chatPage.verifyEditingMode(originalMessage);

      const editedMessage = 'What is 3 + 3?';
      await chatPage.submitEditedMessage(editedMessage);

      await chatPage.verifyConversationMessage(editedMessage);
      await expect(chatPage.getConversationMessage(originalMessage)).not.toBeVisible();
      await chatPage.waitForModelResponse();
    });
  });

test.describe
  .serial('Chat renaming', { tag: '@smoke' }, () => {
    test('[CHAT-RENAME-01] Rename chat from history sidebar', async ({ chatPage }) => {
      await chatPage.ensureChatSidebarVisible();
      await chatPage.clickNewChat();

      const message = 'Test message for renaming';
      await chatPage.sendMessage(message);
      await chatPage.waitForModelResponse();

      // Wait for chat to appear in history
      const initialCount = await chatPage.getChatHistoryCount();
      expect(initialCount).toBeGreaterThan(0);

      // Get the original title (should be auto-generated from the message)
      await expect
        .poll(
          async () => {
            const title = await chatPage.getChatHistoryItemTitle(0);
            return title.trim().length > 0;
          },
          { timeout: TIMEOUTS.MODEL_RESPONSE },
        )
        .toBeTruthy();

      // Rename the chat
      const newTitle = 'My Renamed Chat';
      await chatPage.renameChatHistoryItemByIndex(0, newTitle);

      // Verify the title has been updated
      await expect
        .poll(async () => await chatPage.getChatHistoryItemTitle(0), { timeout: TIMEOUTS.SHORT })
        .toBe(newTitle);

      await chatPage.ensureNotificationsAreNotVisible();
    });

    test('[CHAT-RENAME-02] Cancel rename with Escape key preserves original title', async ({ chatPage }) => {
      await chatPage.ensureChatSidebarVisible();
      await chatPage.clickNewChat();

      const message = 'Test message for cancel rename';
      await chatPage.sendMessage(message);
      await chatPage.waitForModelResponse();

      // Wait for chat to appear in history with auto-generated title
      await expect
        .poll(
          async () => {
            const title = await chatPage.getChatHistoryItemTitle(0);
            return title.trim().length > 0;
          },
          { timeout: TIMEOUTS.MODEL_RESPONSE },
        )
        .toBeTruthy();

      // Capture the original title
      const originalTitle = await chatPage.getChatHistoryItemTitle(0);
      expect(originalTitle).toBeTruthy();

      // Open rename UI, type a new title, but press Escape to cancel
      await chatPage.cancelRenameChatHistoryItemByIndex(0, 'This should not be saved');

      // Verify the title remains unchanged
      const titleAfterCancel = await chatPage.getChatHistoryItemTitle(0);
      expect(titleAfterCancel).toBe(originalTitle);

      await chatPage.ensureNotificationsAreNotVisible();
    });
  });

test.describe
  .serial('Chat message generation control', { tag: '@smoke' }, () => {
    test('[CHAT-GEN-01] Verify send button state changes during message generation', async ({ chatPage }) => {
      await chatPage.clickNewChat();
      await chatPage.verifySendButtonVisible();

      const message = 'What is Podman?';
      await chatPage.sendMessage(message, { waitForMessage: false });

      await chatPage.verifyStopButtonVisible();
      await chatPage.verifySendButtonHidden();

      await chatPage.verifySendButtonVisible(TIMEOUTS.MODEL_RESPONSE);
      await chatPage.verifyStopButtonHidden();
    });

    test('[CHAT-GEN-02] Stop generation cancels the AI response stream', async ({ chatPage }) => {
      await chatPage.clickNewChat();

      // Send a message that should generate a long response
      const message = 'Write a very detailed and long essay about the history of container orchestration systems';
      await chatPage.sendMessage(message, { waitForMessage: false });

      // Verify the stop button appears during generation
      await chatPage.verifyStopButtonVisible();
      await chatPage.verifySendButtonHidden();

      // Click the stop button to cancel generation
      await chatPage.clickStopButton();

      // Verify the UI returns to the ready state
      await chatPage.verifyStopButtonHidden(TIMEOUTS.SHORT);
      await chatPage.verifySendButtonVisible(TIMEOUTS.SHORT);

      // Verify the user message is still visible in the conversation
      await chatPage.verifyConversationMessage(message);
    });
  });

test.describe
  .serial('Chat background streaming', { tag: '@smoke' }, () => {
    test('[CHAT-STREAM-01] Background streaming continues when returning to chat', async ({
      chatPage,
      navigationBar,
      settingsPage,
    }) => {
      await chatPage.clickNewChat();

      // Send a message that should generate a long response
      const message = 'Write a comprehensive and detailed explanation of Kubernetes networking';
      await chatPage.sendMessage(message, { waitForMessage: true });

      // Verify streaming has started
      await chatPage.verifyStopButtonVisible();
      await chatPage.verifySendButtonHidden();

      // Navigate away from the chat page while streaming is active
      await navigationBar.navigateToSettingsPage();
      await settingsPage.waitForLoad();

      // Return to the chat page and select the conversation from history
      await navigationBar.navigateToChatPage();
      await chatPage.waitForLoad();
      await chatPage.ensureChatSidebarVisible();
      await chatPage.clickChatHistoryItemByIndex(0);

      // Verify the user message is visible
      await chatPage.verifyConversationMessage(message);

      // Verify model response is visible (from buffered chunks or completed stream)
      await expect(chatPage.modelConversationMessages.first()).toBeVisible({ timeout: TIMEOUTS.SHORT });

      // The stream may still be active or may have completed while navigated away.
      // Either way, we should see the stop button OR the send button.
      const isStillStreaming = await chatPage.stopButton.isVisible();

      if (isStillStreaming) {
        // Stop the background stream
        await chatPage.clickStopButton();
      }

      // Verify the UI is in ready state (stream finished or was stopped)
      await chatPage.verifyStopButtonHidden(TIMEOUTS.SHORT);
      await chatPage.verifySendButtonVisible(TIMEOUTS.SHORT);

      // Verify the conversation still contains both messages
      await chatPage.verifyConversationMessage(message);
      await expect(chatPage.modelConversationMessages.first()).toBeVisible();
    });
  });

test.describe
  .serial('Chat integrations', { tag: '@smoke' }, () => {
    test('[CHAT-INTG-01] Verify MCP tool list visibility and sidebar interaction', async ({
      mcpSetup: _mcpSetup,
      navigationBar,
      chatPage,
    }) => {
      const skipConditions: Array<{ condition: boolean; reason: string }> = [
        { condition: !hasGithubToken, reason: `${MCP_SERVERS.github.envVarName} environment variable is not set` },
      ];

      for (const { condition, reason } of skipConditions) {
        test.skip(condition, reason);
      }

      await navigationBar.navigateToChatPage();

      await expect(chatPage.toolsSelectionButton).toBeVisible({ timeout: TIMEOUTS.MODEL_RESPONSE });
      await expect(chatPage.configureMcpServersButton).not.toBeVisible();

      await chatPage.ensureToolsSidebarVisible();
      await expect(chatPage.filterToolsInput).toBeVisible();

      await expect(chatPage.getMcpServerLabel(MCP_SERVERS.github.serverName)).toBeVisible();
      const toolCount = await chatPage.getToolCount();
      expect(toolCount).toBeGreaterThan(1);

      const toolName = 'create_branch';
      await chatPage.filterTools(toolName);
      await expect(chatPage.getToolByName(toolName)).toBeVisible();

      await chatPage.filterToolsInput.clear();
      await expect.poll(async () => chatPage.getToolCount()).toBe(toolCount);

      await chatPage.ensureToolsSidebarHidden();
      await expect(chatPage.showMcpPanelButton).toBeVisible();
    });
  });
