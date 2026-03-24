import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Bot } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';
import { TelegramClient } from '../telegram.js';

const TEST_BOT_INFO: UserFromGetMe = {
  id: 999999,
  is_bot: true,
  first_name: 'Test Bot',
  username: 'test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: true,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: true,
  allows_users_to_create_topics: true,
};

type ApiCall = {
  method: string;
  payload: Record<string, unknown>;
};

type ApiResponder = (
  method: string,
  payload: Record<string, unknown>,
) => unknown | undefined | Promise<unknown | undefined>;

function getBot(client: TelegramClient): Bot {
  return (client as unknown as { bot: Bot }).bot;
}

async function createTelegramHarness(
  client: TelegramClient,
  responder?: ApiResponder,
): Promise<{ bot: Bot; calls: ApiCall[] }> {
  const bot = getBot(client);
  const calls: ApiCall[] = [];
  bot.botInfo = TEST_BOT_INFO;

  bot.api.config.use(async (_prev, method, payload) => {
    const normalizedPayload = (payload ?? {}) as Record<string, unknown>;
    calls.push({ method, payload: normalizedPayload });

    const override = await responder?.(method, normalizedPayload);
    if (override !== undefined) {
      return override as ReturnType<typeof _prev>;
    }

    switch (method) {
      case 'sendMessage':
      case 'editMessageText':
        return Promise.resolve({
          ok: true,
          result: {
            message_id: Number(normalizedPayload.message_id ?? 1),
            date: 1,
            chat: {
              id: Number(normalizedPayload.chat_id ?? 1),
              type: 'private',
              first_name: 'Test',
            },
            text: String(normalizedPayload.text ?? ''),
          },
        }) as ReturnType<typeof _prev>;
      case 'answerCallbackQuery':
      case 'sendChatAction':
      case 'setMessageReaction':
        return Promise.resolve({ ok: true, result: true }) as ReturnType<typeof _prev>;
      default:
        return Promise.resolve({ ok: true, result: true }) as ReturnType<typeof _prev>;
    }
  });
  return { bot, calls };
}

function makeTextUpdate(args: {
  messageId: number;
  chatId: number;
  fromId: number;
  text: string;
  threadId?: number;
  replyToMessageId?: number;
  replyText?: string;
}): Update {
  return {
    update_id: 1,
    message: {
      message_id: args.messageId,
      date: 1,
      chat: {
        id: args.chatId,
        type: args.threadId ? 'supergroup' : 'private',
        ...(args.threadId ? { title: 'Debug Topic' } : { first_name: 'Tester' }),
      },
      from: {
        id: args.fromId,
        is_bot: false,
        first_name: 'Tester',
      },
      text: args.text,
      ...(args.threadId ? { message_thread_id: args.threadId, is_topic_message: true } : {}),
      ...(args.replyToMessageId
        ? {
            reply_to_message: {
              message_id: args.replyToMessageId,
              date: 1,
              chat: {
                id: args.chatId,
                type: args.threadId ? 'supergroup' : 'private',
                ...(args.threadId ? { title: 'Debug Topic' } : { first_name: 'Tester' }),
              },
              from: {
                id: args.fromId,
                is_bot: false,
                first_name: 'Tester',
              },
              text: args.replyText ?? 'quoted message',
            },
          }
        : {}),
    },
  } as unknown as Update;
}

function makeCallbackUpdate(args: {
  chatId: number;
  fromId: number;
  messageId: number;
  data: string;
  threadId?: number;
}): Update {
  return {
    update_id: 2,
    callback_query: {
      id: 'callback-1',
      chat_instance: 'chat-instance-1',
      from: {
        id: args.fromId,
        is_bot: false,
        first_name: 'Tester',
      },
      data: args.data,
      message: {
        message_id: args.messageId,
        date: 1,
        chat: {
          id: args.chatId,
          type: args.threadId ? 'supergroup' : 'private',
          ...(args.threadId ? { title: 'Debug Topic' } : { first_name: 'Tester' }),
        },
        from: {
          id: TEST_BOT_INFO.id,
          is_bot: true,
          first_name: TEST_BOT_INFO.first_name,
          username: TEST_BOT_INFO.username,
        },
        text: 'button message',
        ...(args.threadId ? { message_thread_id: args.threadId, is_topic_message: true } : {}),
      },
    },
  } as unknown as Update;
}

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

describe('TelegramClient grammY-style adapter tests', () => {
  it('falls back to plain text when sendMessage HTML rendering fails', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: [],
    });
    const { calls } = await createTelegramHarness(client, (method, payload) => {
      if (method === 'sendMessage' && payload.parse_mode === 'HTML') {
        throw new Error('HTML exploded');
      }
      return undefined;
    });

    const messageId = await client.sendMessage('123', '**bold**');

    assert.equal(messageId, 1);
    const sendCalls = calls.filter((call) => call.method === 'sendMessage');
    assert.equal(sendCalls.length, 2);
    assert.equal(sendCalls[0]?.payload.parse_mode, 'HTML');
    assert.equal(sendCalls[1]?.payload.parse_mode, undefined);
    assert.equal(sendCalls[1]?.payload.text, 'bold');
  });

  it('falls back to plain text when editMessage HTML rendering fails', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: [],
    });
    const { calls } = await createTelegramHarness(client, (method, payload) => {
      if (method === 'editMessageText' && payload.parse_mode === 'HTML') {
        throw new Error('HTML exploded');
      }
      return undefined;
    });

    await client.editMessage('123', 7, '**bold**');

    const editCalls = calls.filter((call) => call.method === 'editMessageText');
    assert.equal(editCalls.length, 2);
    assert.equal(editCalls[0]?.payload.parse_mode, 'HTML');
    assert.equal(editCalls[1]?.payload.parse_mode, undefined);
    assert.equal(editCalls[1]?.payload.text, 'bold');
  });

  it('maps a real text update into onMessage callback arguments', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: ['1'],
    });
    const { bot } = await createTelegramHarness(client);

    let seen:
      | {
          text: string;
          chatId: string;
          msgId: number;
          replyText: string | undefined;
          replyToMsgId: number | undefined;
          threadId: number | undefined;
        }
      | undefined;

    client.onMessage = async (text, chatId, msgId, replyText, replyToMsgId, threadId) => {
      seen = { text, chatId, msgId, replyText, replyToMsgId, threadId };
    };

    await bot.handleUpdate(
      makeTextUpdate({
        messageId: 10,
        chatId: 123,
        fromId: 1,
        text: 'hello from grammY',
        threadId: 77,
        replyToMessageId: 9,
        replyText: 'older message',
      }),
    );

    assert.deepEqual(seen, {
      text: 'hello from grammY',
      chatId: '123',
      msgId: 10,
      replyText: 'older message',
      replyToMsgId: 9,
      threadId: 77,
    });
  });

  it('maps a callback query update and auto-answers the callback', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: ['1'],
    });
    const { bot, calls } = await createTelegramHarness(client);

    let seen:
      | {
          callbackId: string;
          data: string;
          chatId: string;
          msgId: number;
          threadId: number | undefined;
        }
      | undefined;

    client.onCallback = async (callbackId, data, chatId, msgId, threadId) => {
      seen = { callbackId, data, chatId, msgId, threadId };
    };

    await bot.handleUpdate(
      makeCallbackUpdate({
        chatId: 123,
        fromId: 1,
        messageId: 42,
        data: 'agent:notes',
        threadId: 77,
      }),
    );

    assert.deepEqual(seen, {
      callbackId: 'callback-1',
      data: 'agent:notes',
      chatId: '123',
      msgId: 42,
      threadId: 77,
    });
    assert.ok(calls.some((call) => call.method === 'answerCallbackQuery'));
  });

  it('uses mapped thread fallback for callback queries with inaccessible messages', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: ['1'],
    });
    const { bot } = await createTelegramHarness(client);

    const messageId = await client.sendButtons(
      '123',
      'Choose an agent',
      [[{ text: 'Notes', data: 'agent:notes' }]],
      77,
    );

    let seenThreadId: number | undefined;
    client.onCallback = async (_callbackId, _data, _chatId, _msgId, threadId) => {
      seenThreadId = threadId;
    };

    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: 'callback-2',
        chat_instance: 'chat-instance-2',
        from: {
          id: 1,
          is_bot: false,
          first_name: 'Tester',
        },
        data: 'agent:notes',
        message: {
          message_id: messageId ?? 1,
          date: 0,
          chat: {
            id: 123,
            type: 'supergroup',
            title: 'Debug Topic',
          },
        },
      },
    } as unknown as Update);

    assert.equal(seenThreadId, 77);
  });

  it('captures outbound sendButtons payloads through grammY api interception', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: [],
    });
    const { calls } = await createTelegramHarness(client);

    const messageId = await client.sendButtons(
      '123',
      'Choose an agent',
      [[{ text: 'Notes', data: 'agent:notes' }]],
      77,
    );

    assert.equal(messageId, 1);

    const sendMessageCall = calls.find((call) => call.method === 'sendMessage');
    assert.ok(sendMessageCall);
    assert.equal(sendMessageCall?.payload.chat_id, '123');
    assert.equal(sendMessageCall?.payload.message_thread_id, 77);
    assert.equal(sendMessageCall?.payload.text, 'Choose an agent');
    assert.deepEqual(sendMessageCall?.payload.reply_markup, {
      inline_keyboard: [[{ text: 'Notes', callback_data: 'agent:notes' }]],
    });
  });

  it('does not leak client-only button styles into Telegram inline keyboard payloads', async () => {
    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: [],
    });
    const { calls } = await createTelegramHarness(client);

    await client.sendButtons('123', 'Approve this?', [[{ text: 'Approve', data: 'perm:yes', style: 'success' }]], 77);

    const sendMessageCall = calls.find((call) => call.method === 'sendMessage');
    assert.ok(sendMessageCall);
    assert.deepEqual(sendMessageCall?.payload.reply_markup, {
      inline_keyboard: [[{ text: 'Approve', callback_data: 'perm:yes' }]],
    });
  });
});

describe('TelegramClient draft failure handling', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('disables sendDraft only for the failing chat', async () => {
    const calls: string[] = [];

    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return {
        json: async () => ({ ok: false, description: 'unknown method' }),
      } as Response;
    }) as typeof fetch;

    const client = new TelegramClient({
      botToken: 'test-token',
      allowedUsers: [],
    });

    const first = await client.sendDraft('chat-1', 1, 'hello');
    const secondSameChat = await client.sendDraft('chat-1', 2, 'hello again');
    const otherChat = await client.sendDraft('chat-2', 3, 'hello other chat');

    assert.equal(first, false);
    assert.equal(secondSameChat, false);
    assert.equal(otherChat, false);
    assert.equal(calls.length, 2);
  });
});
