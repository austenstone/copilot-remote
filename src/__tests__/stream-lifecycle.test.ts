import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Button, Client, MessageOptions } from '../client.js';
import { finalizeStreamResponse } from '../stream-lifecycle.js';

function createClientSpy() {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const client: Client = {
    name: 'test-client',
    async start() {},
    stop() {},
    async sendMessage(chatId: string, text: string, opts?: MessageOptions) {
      calls.push({ method: 'sendMessage', args: [chatId, text, opts] });
      return 99;
    },
    async editMessage(chatId: string, msgId: number, text: string) {
      calls.push({ method: 'editMessage', args: [chatId, msgId, text] });
    },
    async sendButtons(chatId: string, text: string, buttons: Button[][], threadId?: number) {
      calls.push({ method: 'sendButtons', args: [chatId, text, buttons, threadId] });
      return 100;
    },
    async editButtons(chatId: string, msgId: number, text: string, buttons: Button[][]) {
      calls.push({ method: 'editButtons', args: [chatId, msgId, text, buttons] });
    },
    async sendTyping(chatId: string, threadId?: number) {
      calls.push({ method: 'sendTyping', args: [chatId, threadId] });
    },
    async setReaction(chatId: string, msgId: number, emoji: string) {
      calls.push({ method: 'setReaction', args: [chatId, msgId, emoji] });
    },
    async removeReaction(chatId: string, msgId: number) {
      calls.push({ method: 'removeReaction', args: [chatId, msgId] });
    },
    async deleteMessage(chatId: string, messageId: number) {
      calls.push({ method: 'deleteMessage', args: [chatId, messageId] });
    },
  };

  return { client, calls };
}

describe('finalizeStreamResponse', () => {
  it('edits the streaming placeholder in place for single-chunk replies', async () => {
    const { client, calls } = createClientSpy();

    const result = await finalizeStreamResponse({
      client,
      chatId: 'chat-1',
      streamMsgId: 42,
      final: 'short final response',
      responseMessageOpts: { replyTo: 7 },
    });

    assert.equal(result, 'edited');
    assert.deepEqual(calls, [
      { method: 'editMessage', args: ['chat-1', 42, 'short final response'] },
    ]);
  });

  it('deletes the placeholder and resends for multi-chunk replies', async () => {
    const { client, calls } = createClientSpy();
    const longFinal = 'x'.repeat(5000);

    const result = await finalizeStreamResponse({
      client,
      chatId: 'chat-1',
      streamMsgId: 42,
      final: longFinal,
      responseMessageOpts: { replyTo: 7 },
    });

    assert.equal(result, 'resent');
    assert.deepEqual(calls, [
      { method: 'deleteMessage', args: ['chat-1', 42] },
      { method: 'sendMessage', args: ['chat-1', longFinal, { replyTo: 7 }] },
    ]);
  });

  it('still resends when deleting the placeholder fails', async () => {
    const { client, calls } = createClientSpy();
    client.deleteMessage = async (chatId: string, messageId: number) => {
      calls.push({ method: 'deleteMessage', args: [chatId, messageId] });
      throw new Error('delete no thanks');
    };

    const result = await finalizeStreamResponse({
      client,
      chatId: 'chat-1',
      streamMsgId: 42,
      final: 'x'.repeat(5000),
      responseMessageOpts: { replyTo: 7 },
    });

    assert.equal(result, 'resent');
    assert.deepEqual(calls, [
      { method: 'deleteMessage', args: ['chat-1', 42] },
      { method: 'sendMessage', args: ['chat-1', 'x'.repeat(5000), { replyTo: 7 }] },
    ]);
  });

  it('sends a fresh final message when no streaming placeholder exists', async () => {
    const { client, calls } = createClientSpy();

    const result = await finalizeStreamResponse({
      client,
      chatId: 'chat-1',
      streamMsgId: null,
      final: 'final response',
      responseMessageOpts: { replyTo: 7 },
    });

    assert.equal(result, 'sent');
    assert.deepEqual(calls, [
      { method: 'sendMessage', args: ['chat-1', 'final response', { replyTo: 7 }] },
    ]);
  });
});