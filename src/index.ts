// ============================================================
// Copilot Remote — Main Entry Point
// ============================================================
// Bridges Copilot CLI ↔ Telegram. Your phone becomes a remote
// control for local Copilot coding sessions.
// ============================================================

import { CopilotSession } from './session.js';
import { TelegramBridge } from './telegram.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

function findBinary(name: string): string {
  try {
    return execSync('which ' + name, { encoding: 'utf-8' }).trim();
  } catch {
    return name;
  }
}

interface Config {
  botToken: string;
  allowedUsers: string[];
  workDir: string;
  copilotBinary?: string;
}

function loadConfig(): Config {
  const configPath = path.join(process.cwd(), '.copilot-remote.json');

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  }

  const botToken = process.env.COPILOT_REMOTE_BOT_TOKEN;
  const allowedUsers = process.env.COPILOT_REMOTE_ALLOWED_USERS?.split(',').filter(Boolean) ?? [];
  const workDir = process.env.COPILOT_REMOTE_WORKDIR ?? process.cwd();
  const copilotBinary = process.env.COPILOT_REMOTE_BINARY;

  if (!botToken) {
    console.error('Missing bot token. Set COPILOT_REMOTE_BOT_TOKEN or create .copilot-remote.json');
    process.exit(1);
  }

  return { botToken, allowedUsers, workDir, copilotBinary };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const copilotBin = config.copilotBinary ?? findBinary('copilot');

  console.log('╔══════════════════════════════════════╗');
  console.log('║       ⚡ Copilot Remote v0.1.0       ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║  Copilot CLI ↔ Telegram Bridge       ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('Work dir:', config.workDir);
  console.log('Binary:', copilotBin);
  console.log('Allowed users:', config.allowedUsers.length > 0 ? config.allowedUsers.join(', ') : 'auto-pair first user');
  console.log('');

  const telegram = new TelegramBridge({
    botToken: config.botToken,
    allowedUsers: config.allowedUsers,
  });

  // Per-chat session + work directory
  const sessions = new Map<string, CopilotSession>();
  const chatWorkDirs = new Map<string, string>();

  telegram.setMessageHandler(async (text: string, chatId: string, _messageId: number) => {
    console.log('[Message] ' + chatId + ': ' + text);

    if (text.startsWith('/')) {
      await handleCommand(text, chatId);
      return;
    }

    // Get or create session
    let session = sessions.get(chatId);
    if (!session || !session.alive) {
      // Auto-start session on first message
      session = new CopilotSession();
      const workDir = chatWorkDirs.get(chatId) ?? config.workDir;

      try {
        await session.start({ cwd: workDir, binary: copilotBin });
        sessions.set(chatId, session);
      } catch (err) {
        await telegram.sendMessage(chatId, '❌ Failed to start: ' + String(err));
        return;
      }
    }

    if (session.busy) {
      await telegram.sendMessage(chatId, '⏳ Still processing previous prompt...');
      return;
    }

    // Send prompt to Copilot
    await telegram.sendTyping(chatId);

    try {
      const response = await session.send(text);
      if (response) {
        await telegram.sendMessage(chatId, response);
      } else {
        await telegram.sendMessage(chatId, '(no output)');
      }
    } catch (err) {
      await telegram.sendMessage(chatId, '❌ ' + String(err));
    }
  });

  async function handleCommand(text: string, chatId: string): Promise<void> {
    const [cmd, ...args] = text.split(' ');

    switch (cmd) {
      case '/start': {
        const workDir = args[0] ?? config.workDir;
        chatWorkDirs.set(chatId, workDir);

        const existing = sessions.get(chatId);
        if (existing?.alive) {
          existing.kill();
        }

        const session = new CopilotSession();
        try {
          await session.start({ cwd: workDir, binary: copilotBin });
          sessions.set(chatId, session);
          await telegram.sendMessage(chatId, '✅ Ready in `' + workDir + '`\n\nSend a prompt to get started.');
        } catch (err) {
          await telegram.sendMessage(chatId, '❌ Failed to start: ' + String(err));
        }
        break;
      }

      case '/stop': {
        const session = sessions.get(chatId);
        if (session?.alive) {
          session.kill();
          sessions.delete(chatId);
          await telegram.sendMessage(chatId, '🛑 Session killed.');
        } else {
          await telegram.sendMessage(chatId, 'No active session.');
        }
        break;
      }

      case '/cd': {
        const dir = args[0];
        if (!dir) {
          const current = chatWorkDirs.get(chatId) ?? config.workDir;
          await telegram.sendMessage(chatId, '📂 ' + current);
        } else {
          chatWorkDirs.set(chatId, dir);
          // Restart session in new dir
          const existing = sessions.get(chatId);
          if (existing?.alive) existing.kill();
          sessions.delete(chatId);
          await telegram.sendMessage(chatId, '📂 Switched to `' + dir + '`');
        }
        break;
      }

      case '/status': {
        const session = sessions.get(chatId);
        const workDir = chatWorkDirs.get(chatId) ?? config.workDir;
        if (session?.alive) {
          await telegram.sendMessage(chatId, '✅ Active in `' + workDir + '`' + (session.busy ? ' (busy)' : ''));
        } else {
          await telegram.sendMessage(chatId, '⚪ No active session. Send a message to auto-start.');
        }
        break;
      }

      case '/yes':
      case '/y': {
        const session = sessions.get(chatId);
        if (session?.alive) session.approve();
        else await telegram.sendMessage(chatId, 'No active session.');
        break;
      }

      case '/no':
      case '/n': {
        const session = sessions.get(chatId);
        if (session?.alive) session.deny();
        else await telegram.sendMessage(chatId, 'No active session.');
        break;
      }

      case '/help':
      default:
        await telegram.sendMessage(chatId, [
          '⚡ *Copilot Remote*',
          '',
          '`/start [dir]` — Start in directory',
          '`/stop` — Kill session',
          '`/cd [dir]` — Change/show working directory',
          '`/status` — Session status',
          '`/yes` `/y` — Approve tool action',
          '`/no` `/n` — Deny tool action',
          '`/help` — This message',
          '',
          'Or just type a prompt — session auto-starts.',
        ].join('\n'));
        break;
    }
  }

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    telegram.stopPolling();
    for (const [, session] of sessions) session.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    telegram.stopPolling();
    for (const [, session] of sessions) session.kill();
    process.exit(0);
  });

  await telegram.startPolling();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
