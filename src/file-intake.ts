import type { FileAttachment } from './session.js';

export interface IncomingFileContext {
  fileId: string;
  fileName: string;
  caption: string;
  chatId: string;
  msgId: number;
}

export interface FileIntakeDeps {
  resolveFileUrl(fileId: string): Promise<string | null>;
  download(url: string): Promise<Uint8Array>;
  ensureTempDir(dirPath: string): void;
  writeFile(filePath: string, data: Uint8Array): void;
  transcribeAudio?(filePath: string): Promise<string | null | undefined>;
  handlePrompt(chatId: string, msgId: number, prompt: string, attachments?: FileAttachment[]): Promise<void>;
  sendMessage(chatId: string, text: string): Promise<void>;
  logDebug?(message: string, error: unknown): void;
}

export const FILE_INTAKE_TEMP_DIR = '/tmp/copilot-remote';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const TRANSCRIBABLE_AUDIO_EXTENSIONS = ['.oga', '.ogg'];

export function isImageFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isTranscribableAudio(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return TRANSCRIBABLE_AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function handleIncomingFileUpload(ctx: IncomingFileContext, deps: FileIntakeDeps): Promise<void> {
  const url = await deps.resolveFileUrl(ctx.fileId);
  if (!url) {
    await deps.sendMessage(ctx.chatId, '❌ Could not download file.');
    return;
  }

  try {
    const buffer = await deps.download(url);
    deps.ensureTempDir(FILE_INTAKE_TEMP_DIR);
    const tmpPath = `${FILE_INTAKE_TEMP_DIR}/${ctx.fileName}`;
    deps.writeFile(tmpPath, buffer);

    if (isTranscribableAudio(ctx.fileName) && deps.transcribeAudio) {
      try {
        const transcript = await deps.transcribeAudio(tmpPath);
        if (transcript?.trim()) {
          const prompt = ctx.caption
            ? `${ctx.caption}\n\n(Voice transcription: ${transcript.trim()})`
            : transcript.trim();
          await deps.handlePrompt(ctx.chatId, ctx.msgId, prompt);
          return;
        }
      } catch (error) {
        deps.logDebug?.('Voice transcription failed:', error);
      }
    }

    if (isImageFile(ctx.fileName)) {
      const prompt = ctx.caption || 'Describe this image.';
      const attachments: FileAttachment[] = [{ type: 'file', path: tmpPath }];
      await deps.handlePrompt(ctx.chatId, ctx.msgId, prompt, attachments);
      return;
    }

    const prompt = ctx.caption
      ? `${ctx.caption}\n\n[Attached file: ${tmpPath}]`
      : `I sent you a file: ${tmpPath}\nPlease read and analyze it.`;
    await deps.handlePrompt(ctx.chatId, ctx.msgId, prompt);
  } catch (error) {
    await deps.sendMessage(ctx.chatId, '❌ ' + String(error));
  }
}
