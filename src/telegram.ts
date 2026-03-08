// ============================================================
// Copilot Remote — Telegram Bridge
// ============================================================
// Connects a Copilot CLI session to Telegram using the Bot API.
// Lightweight — uses fetch() directly, no grammy/telegraf dep.
// ============================================================

const TELEGRAM_API = 'https://api.telegram.org/bot';
const POLL_INTERVAL = 1000;
const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramConfig {
  botToken: string;
  allowedUsers: string[]; // Telegram user IDs that can interact
}

export class TelegramBridge {
  private baseUrl: string;
  private offset = 0;
  private polling = false;
  private onMessage: ((text: string, chatId: string, messageId: number) => void) | null = null;

  constructor(private config: TelegramConfig) {
    this.baseUrl = TELEGRAM_API + config.botToken;
  }

  setMessageHandler(handler: (text: string, chatId: string, messageId: number) => void): void {
    this.onMessage = handler;
  }

  async startPolling(): Promise<void> {
    this.polling = true;
    console.log('[Telegram] Polling started');

    while (this.polling) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message?.text) {
            const msg = update.message;
            const userId = String(msg.from?.id);

            if (!this.config.allowedUsers.includes(userId)) {
              await this.sendMessage(msg.chat.id, '⛔ Unauthorized');
              continue;
            }

            this.onMessage?.(msg.text, String(msg.chat.id), msg.message_id);
          }
        }
      } catch (err) {
        console.error('[Telegram] Poll error:', err);
      }

      await sleep(POLL_INTERVAL);
    }
  }

  stopPolling(): void {
    this.polling = false;
  }

  async sendMessage(chatId: string | number, text: string, replyTo?: number): Promise<void> {
    // Split long messages
    const chunks = this.splitMessage(text);

    for (const chunk of chunks) {
      await this.api('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
        ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      }).catch(async () => {
        // Markdown parse failed — retry without parse_mode
        await this.api('sendMessage', {
          chat_id: chatId,
          text: chunk,
          ...(replyTo ? { reply_to_message_id: replyTo } : {}),
        });
      });
    }
  }

  async sendTyping(chatId: string | number): Promise<void> {
    await this.api('sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    }).catch(() => {}); // best effort
  }

  private splitMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // Try to split at newline
      let splitAt = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
      if (splitAt < MAX_MESSAGE_LENGTH * 0.5) {
        // No good newline break — split at space
        splitAt = remaining.lastIndexOf(' ', MAX_MESSAGE_LENGTH);
      }
      if (splitAt < MAX_MESSAGE_LENGTH * 0.3) {
        // Just hard split
        splitAt = MAX_MESSAGE_LENGTH;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  private async getUpdates(): Promise<any[]> {
    const res = await this.api('getUpdates', {
      offset: this.offset,
      timeout: 30,
      allowed_updates: ['message'],
    });
    return res.result ?? [];
  }

  private async api(method: string, body: any): Promise<any> {
    const res = await fetch(this.baseUrl + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json() as any;
    if (!json.ok) {
      throw new Error('Telegram API error: ' + JSON.stringify(json));
    }
    return json;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
