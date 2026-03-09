import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramClient } from '../telegram.js';

describe('TelegramClient.sendDraft', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('attempts draft streaming for topic/supergroup chats', async () => {
    const calls: Array<{ url: string; body: string | undefined }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : undefined,
      });

      return {
        json: async () => ({ ok: true }),
      } as Response;
    }) as typeof fetch;

    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: [],
    });

    const ok = await client.sendDraft('-1001234567890', 42, 'hello topic drafts', {
      threadId: 99,
      replyTo: 7,
    });

    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /sendMessageDraft$/);

    const payload = JSON.parse(calls[0].body ?? '{}') as {
      chat_id?: string;
      draft_id?: number;
      text?: string;
      message_thread_id?: number;
      reply_parameters?: { message_id?: number; allow_sending_without_reply?: boolean };
    };

    assert.equal(payload.chat_id, '-1001234567890');
    assert.equal(payload.draft_id, 42);
    assert.equal(payload.message_thread_id, 99);
    assert.deepEqual(payload.reply_parameters, { message_id: 7, allow_sending_without_reply: true });
    assert.equal(typeof payload.text, 'string');
    assert.ok((payload.text ?? '').includes('hello topic drafts'));
  });
});