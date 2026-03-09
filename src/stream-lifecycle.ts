import type { Client, MessageOptions } from './client.js';
import { markdownToTelegramChunks } from './format.js';

export interface FinalizeStreamResponseArgs {
  client: Client;
  chatId: string;
  streamMsgId: number | null;
  final: string;
  responseMessageOpts: MessageOptions;
}

export async function finalizeStreamResponse({
  client,
  chatId,
  streamMsgId,
  final,
  responseMessageOpts,
}: FinalizeStreamResponseArgs): Promise<'edited' | 'resent' | 'sent'> {
  const chunks = final ? markdownToTelegramChunks(final, 4096) : [];

  if (streamMsgId && chunks.length <= 1) {
    await client.editMessage(chatId, streamMsgId, final);
    return 'edited';
  }

  if (streamMsgId) {
    await client.deleteMessage?.(chatId, streamMsgId).catch(() => {});
    await client.sendMessage(chatId, final, responseMessageOpts);
    return 'resent';
  }

  await client.sendMessage(chatId, final, responseMessageOpts);
  return 'sent';
}