import * as readline from 'readline';
import * as path from 'path';
import type { Button, Client, MessageOptions } from '../client.js';

interface StoredMessage {
  text: string;
  buttons?: Button[][];
  threadId?: number;
}

export interface MockTelegramHarnessConfig {
  chatId?: string;
  quiet?: boolean;
}

export class MockTelegramHarness implements Client {
  readonly name = 'mock-telegram-harness';

  onMessage?: Client['onMessage'];
  onCallback?: Client['onCallback'];
  onReaction?: Client['onReaction'];
  onFile?: Client['onFile'];
  onInlineQuery?: Client['onInlineQuery'];

  private rl: readline.Interface | null = null;
  private started = false;
  private startResolve: (() => void) | null = null;
  private nextMessageId = 1;
  private nextCallbackId = 1;
  private nextInlineQueryId = 1;
  private nextDraftIdValue = 1;
  private currentChatId: string;
  private currentThreadId: number | undefined;
  private topicNames = new Map<string, string>();
  private messages = new Map<number, StoredMessage>();
  private quiet: boolean;

  constructor(config: MockTelegramHarnessConfig = {}) {
    this.currentChatId = config.chatId ?? 'local-dev-chat';
    this.quiet = config.quiet ?? false;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.printBanner();
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'mock-telegram> ' });
    this.rl.on('line', (line) => {
      void this.handleLine(line);
    });
    this.rl.on('close', () => {
      this.started = false;
      this.startResolve?.();
      this.startResolve = null;
    });
    this.rl.prompt();
    await new Promise<void>((resolve) => {
      this.startResolve = resolve;
    });
  }

  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async sendMessage(chatId: string, text: string, opts?: MessageOptions): Promise<number> {
    const msgId = this.allocateMessageId();
    this.messages.set(msgId, { text, threadId: opts?.threadId });
    this.log('out', msgId, this.formatMessage(chatId, text, opts));
    return msgId;
  }

  async editMessage(chatId: string, msgId: number, text: string): Promise<void> {
    const existing = this.messages.get(msgId);
    this.messages.set(msgId, { text, buttons: existing?.buttons, threadId: existing?.threadId });
    this.log(
      'edit',
      msgId,
      this.formatMessage(chatId, text, existing?.threadId ? { threadId: existing.threadId } : undefined),
    );
  }

  async sendButtons(chatId: string, text: string, buttons: Button[][], threadId?: number): Promise<number> {
    const msgId = this.allocateMessageId();
    this.messages.set(msgId, { text, buttons, threadId });
    this.log('buttons', msgId, this.formatMessage(chatId, text, threadId ? { threadId } : undefined));
    this.printButtons(buttons);
    return msgId;
  }

  async editButtons(chatId: string, msgId: number, text: string, buttons: Button[][]): Promise<void> {
    const existing = this.messages.get(msgId);
    this.messages.set(msgId, { text, buttons, threadId: existing?.threadId });
    this.log(
      'edit-buttons',
      msgId,
      this.formatMessage(chatId, text, existing?.threadId ? { threadId: existing.threadId } : undefined),
    );
    if (buttons.length) this.printButtons(buttons);
  }

  async sendTyping(chatId: string, threadId?: number): Promise<void> {
    this.log('typing', null, `${chatId}${threadId ? ` [thread ${threadId}]` : ''}`);
  }

  async setReaction(chatId: string, msgId: number, emoji: string): Promise<void> {
    this.log('react', msgId, `${emoji} -> ${chatId}`);
  }

  async removeReaction(chatId: string, msgId: number): Promise<void> {
    this.log('react-clear', msgId, chatId);
  }

  async sendDraft(chatId: string, draftId: number, text: string, opts?: MessageOptions): Promise<boolean> {
    this.log('draft', draftId, this.formatMessage(chatId, text, opts));
    return true;
  }

  allocateDraftId(): number {
    return this.nextDraftIdValue++;
  }

  async createForumTopic(chatId: string, name: string): Promise<number> {
    const threadId = this.allocateMessageId();
    this.topicNames.set(`${chatId}:${threadId}`, name);
    this.log('topic-create', threadId, `${chatId} -> ${name}`);
    return threadId;
  }

  async deleteForumTopic(chatId: string, threadId: number): Promise<void> {
    this.topicNames.delete(`${chatId}:${threadId}`);
    this.log('topic-delete', threadId, chatId);
  }

  async pinMessage(chatId: string, messageId: number): Promise<void> {
    this.log('pin', messageId, chatId);
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    this.messages.delete(messageId);
    this.log('delete', messageId, chatId);
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    this.log('callback-answer', null, `${callbackId}${text ? ` ${text}` : ''}`);
  }

  async answerInlineQuery(queryId: string, results: Record<string, unknown>[]): Promise<void> {
    this.log('inline-answer', null, `${queryId} (${results.length} result(s))`);
  }

  getTopicName(sessionKey: string): string | undefined {
    return this.topicNames.get(sessionKey);
  }

  setCurrentChat(chatId: string): void {
    this.currentChatId = chatId;
    this.currentThreadId = undefined;
    this.log('state', null, `chat=${chatId}`);
  }

  setCurrentTopic(threadId?: number, name?: string): void {
    this.currentThreadId = threadId;
    if (threadId && name) this.topicNames.set(`${this.currentChatId}:${threadId}`, name);
    this.log('state', null, threadId ? `thread=${threadId}${name ? ` (${name})` : ''}` : 'thread=dm');
  }

  async simulateMessage(text: string): Promise<void> {
    const msgId = this.allocateMessageId();
    this.messages.set(msgId, { text, threadId: this.currentThreadId });
    this.log('in', msgId, this.formatIncoming(text));
    await this.onMessage?.(text, this.currentChatId, msgId, undefined, undefined, this.currentThreadId);
  }

  async simulateReply(replyToMsgId: number, text: string): Promise<void> {
    const msgId = this.allocateMessageId();
    const replyText = this.messages.get(replyToMsgId)?.text;
    this.messages.set(msgId, { text, threadId: this.currentThreadId });
    this.log('in-reply', msgId, `replyTo=#${replyToMsgId} ${this.formatIncoming(text)}`);
    await this.onMessage?.(text, this.currentChatId, msgId, replyText, replyToMsgId, this.currentThreadId);
  }

  async simulateCallback(msgId: number, data: string): Promise<void> {
    const callbackId = `mock-cb-${this.nextCallbackId++}`;
    this.log('callback', msgId, data);
    await this.onCallback?.(callbackId, data, this.currentChatId, msgId, this.currentThreadId);
  }

  async simulateReaction(msgId: number, emoji: string): Promise<void> {
    this.log('reaction-in', msgId, emoji);
    await this.onReaction?.(emoji, this.currentChatId, msgId, this.currentThreadId);
  }

  async simulateFile(filePath: string, caption = ''): Promise<void> {
    const msgId = this.allocateMessageId();
    const fileId = `mock-file-${msgId}`;
    const fileName = path.basename(filePath);
    this.log('file-in', msgId, `${fileName}${caption ? ` — ${caption}` : ''}`);
    await this.onFile?.(fileId, fileName, caption, this.currentChatId, msgId, this.currentThreadId);
  }

  async simulateInlineQuery(query: string): Promise<void> {
    const queryId = `mock-inline-${this.nextInlineQueryId++}`;
    this.log('inline-in', null, query);
    await this.onInlineQuery?.(queryId, query);
  }

  private async handleLine(rawLine: string): Promise<void> {
    const line = rawLine.trim();
    if (!line) {
      this.rl?.prompt();
      return;
    }

    if (!line.startsWith('/mock ')) {
      await this.simulateMessage(line);
      this.rl?.prompt();
      return;
    }

    const [, command, ...rest] = line.split(' ');
    switch (command) {
      case 'help':
        this.printHelp();
        break;
      case 'chat':
        if (rest[0]) this.setCurrentChat(rest[0]);
        break;
      case 'topic': {
        const value = rest[0];
        if (!value || value === 'dm') {
          this.setCurrentTopic(undefined);
        } else {
          const threadId = Number(value);
          if (!Number.isNaN(threadId)) this.setCurrentTopic(threadId, rest.slice(1).join(' ') || undefined);
        }
        break;
      }
      case 'reply': {
        const replyTo = Number(rest[0]);
        if (!Number.isNaN(replyTo) && rest.length > 1) {
          await this.simulateReply(replyTo, rest.slice(1).join(' '));
        }
        break;
      }
      case 'callback': {
        const msgId = Number(rest[0]);
        if (!Number.isNaN(msgId) && rest.length > 1) {
          await this.simulateCallback(msgId, rest.slice(1).join(' '));
        }
        break;
      }
      case 'reaction': {
        const msgId = Number(rest[0]);
        if (!Number.isNaN(msgId) && rest[1]) await this.simulateReaction(msgId, rest[1]);
        break;
      }
      case 'file':
        if (rest[0]) await this.simulateFile(rest[0], rest.slice(1).join(' '));
        break;
      case 'inline':
        if (rest.length) await this.simulateInlineQuery(rest.join(' '));
        break;
      case 'quit':
      case 'exit':
        this.stop();
        break;
      default:
        this.printHelp();
        break;
    }

    this.rl?.prompt();
  }

  private allocateMessageId(): number {
    return this.nextMessageId++;
  }

  private formatMessage(chatId: string, text: string, opts?: MessageOptions): string {
    const parts = [`chat=${chatId}`];
    if (opts?.threadId) parts.push(`thread=${opts.threadId}`);
    if (opts?.replyTo) parts.push(`replyTo=#${opts.replyTo}`);
    return `${parts.join(' ')}\n${text}`;
  }

  private formatIncoming(text: string): string {
    return `${this.currentChatId}${this.currentThreadId ? ` [thread ${this.currentThreadId}]` : ''}\n${text}`;
  }

  private printButtons(buttons: Button[][]): void {
    if (this.quiet) return;
    for (const row of buttons) {
      console.log(`    ${row.map((button) => `[${button.text}] => ${button.data}`).join(' | ')}`);
    }
  }

  private log(kind: string, id: number | null, message: string): void {
    if (this.quiet) return;
    const prefix = id === null ? `[mock:${kind}]` : `[mock:${kind} #${id}]`;
    console.log(`${prefix} ${message}`);
  }

  private printBanner(): void {
    if (this.quiet) return;
    console.log('🧪 Mock Telegram harness enabled');
    this.printHelp();
  }

  private printHelp(): void {
    if (this.quiet) return;
    console.log(
      [
        'Commands:',
        '  <text>                          send a normal incoming message',
        '  /mock help                      show this help',
        '  /mock chat <chatId>             switch active chat id',
        '  /mock topic <threadId> [name]   switch to topic/thread mode',
        '  /mock topic dm                  switch back to DM mode',
        '  /mock reply <msgId> <text>      send a reply to a previous message',
        '  /mock callback <msgId> <data>   simulate button press callback data',
        '  /mock reaction <msgId> <emoji>  simulate a user reaction',
        '  /mock file <path> [caption]     simulate a file upload',
        '  /mock inline <query>            simulate an inline query',
        '  /mock quit                      exit the harness',
      ].join('\n'),
    );
  }
}
