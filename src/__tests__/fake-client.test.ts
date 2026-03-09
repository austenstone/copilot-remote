import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockTelegramHarness } from '../testing/mock-telegram-harness.js';

describe('MockTelegramHarness', () => {
  it('simulates incoming messages against the current chat/thread', async () => {
    const client = new MockTelegramHarness({ chatId: 'chat-1', quiet: true });
    client.setCurrentTopic(77, 'Debug Topic');

    let seen: Record<string, unknown> | undefined;
    client.onMessage = async (text, chatId, msgId, replyText, replyToMsgId, threadId) => {
      seen = { text, chatId, msgId, replyText, replyToMsgId, threadId };
    };

    await client.simulateMessage('hello from mock telegram');

    assert.deepEqual(seen, {
      text: 'hello from mock telegram',
      chatId: 'chat-1',
      msgId: 1,
      replyText: undefined,
      replyToMsgId: undefined,
      threadId: 77,
    });
    assert.equal(client.getTopicName('chat-1:77'), 'Debug Topic');
  });

  it('simulates replies using stored message text', async () => {
    const client = new MockTelegramHarness({ chatId: 'chat-1', quiet: true });
    const sentId = await client.sendMessage('chat-1', 'bot said hello');

    let seen: Record<string, unknown> | undefined;
    client.onMessage = async (text, chatId, msgId, replyText, replyToMsgId) => {
      seen = { text, chatId, msgId, replyText, replyToMsgId };
    };

    await client.simulateReply(sentId, 'user reply');

    assert.deepEqual(seen, {
      text: 'user reply',
      chatId: 'chat-1',
      msgId: 2,
      replyText: 'bot said hello',
      replyToMsgId: 1,
    });
  });

  it('simulates callback queries with stable chat context', async () => {
    const client = new MockTelegramHarness({ chatId: 'chat-1', quiet: true });

    let seen: Record<string, unknown> | undefined;
    client.onCallback = async (callbackId, data, chatId, msgId, threadId) => {
      seen = { callbackId, data, chatId, msgId, threadId };
    };

    await client.simulateCallback(42, 'agent:notes');

    assert.deepEqual(seen, {
      callbackId: 'mock-cb-1',
      data: 'agent:notes',
      chatId: 'chat-1',
      msgId: 42,
      threadId: undefined,
    });
  });

  it('clears thread state when switching to a different chat', async () => {
    const client = new MockTelegramHarness({ chatId: 'chat-1', quiet: true });
    client.setCurrentTopic(77, 'Debug Topic');
    client.setCurrentChat('chat-2');

    let seen: Record<string, unknown> | undefined;
    client.onMessage = async (text, chatId, msgId, replyText, replyToMsgId, threadId) => {
      seen = { text, chatId, msgId, replyText, replyToMsgId, threadId };
    };

    await client.simulateMessage('new chat, no thread please');

    assert.deepEqual(seen, {
      text: 'new chat, no thread please',
      chatId: 'chat-2',
      msgId: 1,
      replyText: undefined,
      replyToMsgId: undefined,
      threadId: undefined,
    });
  });
});