import * as fs from 'fs';

interface CdClient {
  sendMessage: (chatId: string, text: string) => Promise<unknown>;
}

interface CdSession {
  alive?: boolean;
  kill?: () => void | Promise<void>;
}

export interface CdCommandDeps {
  client: CdClient;
  sessions: Map<string, CdSession>;
  workDirs: Map<string, string>;
  getSession: (chatId: string) => Promise<unknown>;
}

export async function handleCdCommand(
  arg: string | undefined,
  chatId: string,
  deps: CdCommandDeps,
): Promise<boolean> {
  if (!arg) {
    await deps.client.sendMessage(chatId, '📂 ' + (deps.workDirs.get(chatId) ?? process.cwd()));
    return true;
  }

  const newDir = arg.startsWith('~') ? arg.replace('~', process.env.HOME ?? '/') : arg;
  if (!fs.existsSync(newDir)) {
    await deps.client.sendMessage(chatId, '❌ Directory not found: `' + newDir + '`');
    return true;
  }

  deps.workDirs.set(chatId, newDir);
  const oldSession = deps.sessions.get(chatId);

  if (oldSession?.alive) {
    await oldSession.kill?.();
    deps.sessions.delete(chatId);
    await deps.client.sendMessage(chatId, '📂 `' + newDir + '`\nRestarting session...');
  } else {
    await deps.client.sendMessage(chatId, '📂 `' + newDir + '`\nStarting session...');
  }

  try {
    await deps.getSession(chatId);
    await deps.client.sendMessage(chatId, '✅ Ready in `' + newDir + '`');
  } catch (error) {
    await deps.client.sendMessage(chatId, '❌ Failed to start session in `' + newDir + '`\n' + String(error));
  }

  return true;
}