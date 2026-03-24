import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FileAttachment } from '../session.js';
import { FILE_INTAKE_TEMP_DIR, handleIncomingFileUpload, isImageFile, isTranscribableAudio } from '../file-intake.js';

function createDeps(overrides: Partial<Parameters<typeof handleIncomingFileUpload>[1]> = {}) {
  const sentMessages: Array<{ chatId: string; text: string }> = [];
  const prompts: Array<{ chatId: string; msgId: number; prompt: string; attachments?: FileAttachment[] }> = [];
  const writes: Array<{ path: string; data: Uint8Array }> = [];
  const directories: string[] = [];
  const debugLogs: Array<{ message: string; error: unknown }> = [];

  const deps: Parameters<typeof handleIncomingFileUpload>[1] = {
    async resolveFileUrl() {
      return 'https://example.com/file';
    },
    async download() {
      return new Uint8Array([1, 2, 3]);
    },
    ensureTempDir(dirPath) {
      directories.push(dirPath);
    },
    writeFile(filePath, data) {
      writes.push({ path: filePath, data });
    },
    async transcribeAudio() {
      return null;
    },
    async handlePrompt(chatId, msgId, prompt, attachments) {
      prompts.push({ chatId, msgId, prompt, attachments });
    },
    async sendMessage(chatId, text) {
      sentMessages.push({ chatId, text });
    },
    logDebug(message, error) {
      debugLogs.push({ message, error });
    },
    ...overrides,
  };

  return { deps, sentMessages, prompts, writes, directories, debugLogs };
}

describe('file intake helpers', () => {
  it('detects supported image and voice file types case-insensitively', () => {
    assert.equal(isImageFile('Screenshot.PNG'), true);
    assert.equal(isImageFile('notes.txt'), false);
    assert.equal(isTranscribableAudio('voice.OGA'), true);
    assert.equal(isTranscribableAudio('voice.mp3'), false);
  });
});

describe('handleIncomingFileUpload', () => {
  it('notifies the user when Telegram cannot resolve a download URL', async () => {
    const { deps, sentMessages, prompts } = createDeps({
      async resolveFileUrl() {
        return null;
      },
    });

    await handleIncomingFileUpload(
      { fileId: 'file-1', fileName: 'notes.txt', caption: '', chatId: 'chat-1', msgId: 1 },
      deps,
    );

    assert.deepEqual(sentMessages, [{ chatId: 'chat-1', text: '❌ Could not download file.' }]);
    assert.equal(prompts.length, 0);
  });

  it('surfaces download failures back to the user', async () => {
    const boom = new Error('network exploded');
    const { deps, sentMessages } = createDeps({
      async download() {
        throw boom;
      },
    });

    await handleIncomingFileUpload(
      { fileId: 'file-1', fileName: 'notes.txt', caption: '', chatId: 'chat-1', msgId: 1 },
      deps,
    );

    assert.deepEqual(sentMessages, [{ chatId: 'chat-1', text: '❌ Error: network exploded' }]);
  });

  it('falls back to file analysis when voice transcription blows up', async () => {
    const { deps, prompts, debugLogs, writes, directories } = createDeps({
      async transcribeAudio() {
        throw new Error('ffmpeg sad');
      },
    });

    await handleIncomingFileUpload(
      { fileId: 'file-1', fileName: 'voice.ogg', caption: 'What did I say?', chatId: 'chat-1', msgId: 1 },
      deps,
    );

    assert.deepEqual(directories, [FILE_INTAKE_TEMP_DIR]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.path, `${FILE_INTAKE_TEMP_DIR}/voice.ogg`);
    assert.deepEqual(prompts, [
      {
        chatId: 'chat-1',
        msgId: 1,
        prompt: `What did I say?\n\n[Attached file: ${FILE_INTAKE_TEMP_DIR}/voice.ogg]`,
        attachments: undefined,
      },
    ]);
    assert.equal(debugLogs.length, 1);
    assert.equal(debugLogs[0]?.message, 'Voice transcription failed:');
  });

  it('routes image uploads through SDK attachments for vision flows', async () => {
    const { deps, prompts } = createDeps();

    await handleIncomingFileUpload(
      { fileId: 'file-1', fileName: 'diagram.png', caption: '', chatId: 'chat-1', msgId: 1 },
      deps,
    );

    assert.deepEqual(prompts, [
      {
        chatId: 'chat-1',
        msgId: 1,
        prompt: 'Describe this image.',
        attachments: [{ type: 'file', path: `${FILE_INTAKE_TEMP_DIR}/diagram.png` }],
      },
    ]);
  });

  it('uses transcription text directly when voice transcription succeeds', async () => {
    const { deps, prompts } = createDeps({
      async transcribeAudio() {
        return 'ship it';
      },
    });

    await handleIncomingFileUpload(
      { fileId: 'file-1', fileName: 'voice.oga', caption: 'Summarize this', chatId: 'chat-1', msgId: 1 },
      deps,
    );

    assert.deepEqual(prompts, [
      {
        chatId: 'chat-1',
        msgId: 1,
        prompt: 'Summarize this\n\n(Voice transcription: ship it)',
        attachments: undefined,
      },
    ]);
  });
});
