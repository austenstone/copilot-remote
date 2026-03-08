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

interface Config {
  botToken: string;
  allowedUsers: string[]; // empty = auto-pair first user
  workDir: string;
  copilotBinary?: string;
}

function loadConfig(): Config {
  // Try config file first, then env vars
  const configPath = path.join(process.cwd(), '.copilot-remote.json');

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  }

  // Fall back to env vars
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

  console.log('╔══════════════════════════════════════╗');
  console.log('║       ⚡ Copilot Remote v0.1.0       ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║  Copilot CLI ↔ Telegram Bridge       ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('Work dir:', config.workDir);
  console.log('Allowed users:', config.allowedUsers.length > 0 ? config.allowedUsers.join(', ') : 'auto-pair first user');
  console.log('');

  // Initialize Telegram bridge
  const telegram = new TelegramBridge({
    botToken: config.botToken,
    allowedUsers: config.allowedUsers,
  });

  // Session state per chat
  const sessions = new Map<string, CopilotSession>();
  let activeChatId: string | null = null;

  // Command handlers
  telegram.setMessageHandler(async (text: string, chatId: string, messageId: number) => {
    console.log('[Message] ' + chatId + ': ' + text);

    // Handle commands
    if (text.startsWith('/')) {
      await handleCommand(text, chatId, messageId);
      return;
    }

    // Get or prompt for session
    const session = sessions.get(chatId);
    if (!session || !session.alive) {
      await telegram.sendMessage(chatId, [
        '⚡ No active Copilot session.',
        '',
        'Commands:',
        '`/start [dir]` — Start a new session',
        '`/status` — Check session status',
        '`/stop` — Kill current session',
        '`/yes` — Approve tool action',
        '`/no` — Deny tool action',
      ].join('\n'));
      return;
    }

    // Send to Copilot
    await telegram.sendTyping(chatId);
    session.send(text);
  });

  async function handleCommand(text: string, chatId: string, messageId: number): Promise<void> {
    const [cmd, ...args] = text.split(' ');

    switch (cmd) {
      case '/start': {
        const workDir = args[0] ?? config.workDir;

        // Kill existing session if any
        const existing = sessions.get(chatId);
        if (existing?.alive) {
          existing.kill();
        }

        await telegram.sendMessage(chatId, '🚀 Starting Copilot session in `' + workDir + '`...');

        const session = new CopilotSession();
        sessions.set(chatId, session);
        activeChatId = chatId;

        // Wire up events
        session.on('response', async (response: string) => {
          console.log('[Response] ' + response.slice(0, 100) + '...');
          await telegram.sendMessage(chatId, response);
        });

        session.on('waiting', async () => {
          // Copilot is waiting for input — could show a subtle indicator
        });

        session.on('exit', async (code: number) => {
          await telegram.sendMessage(chatId, '💀 Copilot session exited (code ' + code + ')');
          sessions.delete(chatId);
        });

        session.on('error', async (err: Error) => {
          await telegram.sendMessage(chatId, '❌ Error: ' + err.message);
        });

        try {
          await session.start({
            cwd: workDir,
            shell: config.copilotBinary ?? 'copilot',
          });
          await telegram.sendMessage(chatId, '✅ Copilot session ready. Send a prompt to get started.');
        } catch (err) {
          await telegram.sendMessage(chatId, '❌ Failed to start: ' + String(err));
          sessions.delete(chatId);
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

      case '/status': {
        const session = sessions.get(chatId);
        if (session?.alive) {
          await telegram.sendMessage(chatId, '✅ Session is running.');
        } else {
          await telegram.sendMessage(chatId, '⚪ No active session.');
        }
        break;
      }

      case '/yes':
      case '/y': {
        const session = sessions.get(chatId);
        if (session?.alive) {
          session.approve();
        } else {
          await telegram.sendMessage(chatId, 'No active session.');
        }
        break;
      }

      case '/no':
      case '/n': {
        const session = sessions.get(chatId);
        if (session?.alive) {
          session.deny();
        } else {
          await telegram.sendMessage(chatId, 'No active session.');
        }
        break;
      }

      case '/raw': {
        // Send raw text to PTY (for debugging)
        const session = sessions.get(chatId);
        if (session?.alive) {
          const raw = args.join(' ');
          session.send(raw);
        }
        break;
      }

      case '/help':
      default:
        await telegram.sendMessage(chatId, [
          '⚡ *Copilot Remote*',
          '',
          '`/start [dir]` — Start Copilot in directory',
          '`/stop` — Kill session',
          '`/status` — Check if session is alive',
          '`/yes` `/y` — Approve tool action',
          '`/no` `/n` — Deny tool action',
          '`/raw <text>` — Send raw input',
          '`/help` — This message',
          '',
          'Or just type a prompt to send to Copilot.',
        ].join('\n'));
        break;
    }
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    telegram.stopPolling();
    for (const [, session] of sessions) {
      session.kill();
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    telegram.stopPolling();
    for (const [, session] of sessions) {
      session.kill();
    }
    process.exit(0);
  });

  // Start polling
  await telegram.startPolling();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
