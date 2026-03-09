import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleCdCommand } from '../cd-command.js';

function createDeps() {
  const client = {
    sendMessageCalls: [] as Array<{ chatId: string; text: string }>,
    async sendMessage(chatId: string, text: string) {
      this.sendMessageCalls.push({ chatId, text });
    },
  };

  return {
    client,
    sessions: new Map<string, { alive?: boolean; kill?: () => void | Promise<void> }>(),
    workDirs: new Map<string, string>(),
    getSessionCalls: [] as string[],
    deps: {
      client,
      sessions: new Map<string, { alive?: boolean; kill?: () => void | Promise<void> }>(),
      workDirs: new Map<string, string>(),
      getSession: async (_chatId: string) => undefined,
    },
  };
}

describe('handleCdCommand', () => {
  it('starts a session immediately when no session is active', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-remote-cd-'));
    const client = {
      sendMessageCalls: [] as Array<{ chatId: string; text: string }>,
      async sendMessage(chatId: string, text: string) {
        this.sendMessageCalls.push({ chatId, text });
      },
    };
    const sessions = new Map<string, { alive?: boolean; kill?: () => void | Promise<void> }>();
    const workDirs = new Map<string, string>();
    const getSessionCalls: string[] = [];

    try {
      await handleCdCommand(tempDir, 'chat-1', {
        client,
        sessions,
        workDirs,
        getSession: async (chatId: string) => {
          getSessionCalls.push(chatId);
          return { alive: true };
        },
      });

      assert.equal(workDirs.get('chat-1'), tempDir);
      assert.deepEqual(getSessionCalls, ['chat-1']);
      assert.equal(client.sendMessageCalls[0]?.text, '📂 `' + tempDir + '`\nStarting session...');
      assert.equal(client.sendMessageCalls[1]?.text, '✅ Ready in `' + tempDir + '`');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('kills and restarts the live session in the new directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-remote-cd-'));
    const client = {
      sendMessageCalls: [] as Array<{ chatId: string; text: string }>,
      async sendMessage(chatId: string, text: string) {
        this.sendMessageCalls.push({ chatId, text });
      },
    };
    let killed = false;
    const sessions = new Map<string, { alive?: boolean; kill?: () => void | Promise<void> }>([
      ['chat-1', { alive: true, kill: () => { killed = true; } }],
    ]);
    const workDirs = new Map<string, string>();

    try {
      await handleCdCommand(tempDir, 'chat-1', {
        client,
        sessions,
        workDirs,
        getSession: async () => ({ alive: true }),
      });

      assert.equal(killed, true);
      assert.equal(sessions.has('chat-1'), false);
      assert.equal(client.sendMessageCalls[0]?.text, '📂 `' + tempDir + '`\nRestarting session...');
      assert.equal(client.sendMessageCalls[1]?.text, '✅ Ready in `' + tempDir + '`');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});