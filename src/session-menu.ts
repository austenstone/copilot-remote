import type { Button } from './client.js';
import type { SessionOptions } from './session.js';
import type { SessionEntry } from './store.js';

interface SessionMenuClient {
  sendMessage?: (chatId: string, text: string) => Promise<number | null>;
  editButtons: (chatId: string, msgId: number, text: string, buttons: Button[][]) => Promise<void>;
  answerCallback?: (callbackId: string, text?: string, showAlert?: boolean) => Promise<void>;
}

interface ResumableSession {
  alive?: boolean;
  sessionId?: string | null;
  disconnect?: () => Promise<void>;
  resume: (sessionId: string, opts: SessionOptions) => Promise<void>;
}

interface SessionMenuStore {
  getBySessionId: (sessionId: string) => SessionEntry | undefined;
  set: (chatId: string, entry: SessionEntry) => void;
}

export interface SessionMenuDeps {
  client: SessionMenuClient;
  sessions: Map<string, ResumableSession>;
  sessionStore: SessionMenuStore;
  getWorkDir: (chatId: string) => string;
  rememberWorkDir: (chatId: string, cwd: string) => void;
  createSession: () => ResumableSession;
  buildResumeOptions: (chatId: string, cwd: string, sessionId: string) => SessionOptions;
  registerSessionListeners: (session: ResumableSession, chatId: string) => void;
}

export interface AttachSessionResult {
  ok: boolean;
  message: string;
  callbackText?: string;
  showAlert?: boolean;
}

export function normalizeSessionIdInput(input: string): string {
  const trimmed = input.trim().replace(/^`+|`+$/g, '');
  const resumeMatch = trimmed.match(/(?:^|\s)--resume\s+([^\s`]+)/);
  if (resumeMatch?.[1]) return resumeMatch[1];

  const commandMatch = trimmed.match(/copilot\s+--resume\s+([^\s`]+)/);
  if (commandMatch?.[1]) return commandMatch[1];

  return trimmed.split(/\s+/).at(-1) ?? '';
}

export function formatSessionIdMessage(sessionId: string, cwd?: string): string {
  const lines = [
    '🆔 *Session ID*',
    '',
    '`' + sessionId + '`',
    '',
    '*Resume from Copilot CLI or a VS Code Copilot CLI session:*',
    '```text\ncopilot --resume ' + sessionId + '\n```',
    '*Attach from another copilot-remote chat:*',
    '`/attach ' + sessionId + '`',
  ];

  if (cwd) {
    lines.push('', '📂 `' + cwd + '`');
  }

  return lines.join('\n');
}

export async function attachSessionById(
  input: string,
  chatId: string,
  deps: SessionMenuDeps,
): Promise<AttachSessionResult> {
  const selectedSessionId = normalizeSessionIdInput(input);
  if (!selectedSessionId) {
    return {
      ok: false,
      message: '❌ Provide a valid session id or `copilot --resume <id>` command.',
      callbackText: 'Missing session id',
      showAlert: true,
    };
  }

  const entry = deps.sessionStore.getBySessionId(selectedSessionId);
  const current = deps.sessions.get(chatId);

  if (current?.alive && current.sessionId === selectedSessionId) {
    return {
      ok: true,
      message: '✅ Already attached to this session. Send a message to keep going.',
      callbackText: 'Already on this session',
    };
  }

  const activeElsewhere = [...deps.sessions.entries()].find(
    ([otherChatId, session]) => otherChatId !== chatId && session.alive && session.sessionId === selectedSessionId,
  );
  if (activeElsewhere) {
    return {
      ok: false,
      message: '🟢 That session is already active in another chat/topic. Pause it there first, then attach it here.',
      callbackText: 'Session already active elsewhere',
      showAlert: true,
    };
  }

  const targetCwd = entry?.cwd || deps.getWorkDir(chatId);
  const resumeOpts = deps.buildResumeOptions(chatId, targetCwd, selectedSessionId);
  const nextSession = deps.createSession();

  try {
    if (current?.alive) await current.disconnect?.();
    deps.sessions.delete(chatId);

    await nextSession.resume(selectedSessionId, resumeOpts);

    deps.rememberWorkDir(chatId, targetCwd);
    deps.registerSessionListeners(nextSession, chatId);
    deps.sessions.set(chatId, nextSession);
    deps.sessionStore.set(chatId, {
      sessionId: selectedSessionId,
      cwd: targetCwd,
      model: resumeOpts.model ?? entry?.model ?? '',
      createdAt: entry?.createdAt ?? Date.now(),
      lastUsed: Date.now(),
    });

    return {
      ok: true,
      message:
        '🔁 Resumed session. Send a message to continue.\n\n' +
        '🆔 `' +
        selectedSessionId +
        '`\n' +
        '📂 `' +
        targetCwd +
        '`',
      callbackText: 'Session resumed',
    };
  } catch (error) {
    deps.sessions.delete(chatId);
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: '❌ Failed to resume session:\n`' + message.slice(0, 300) + '`',
      callbackText: 'Resume failed',
      showAlert: true,
    };
  }
}

export async function handleSessionCallback(
  data: string,
  chatId: string,
  msgId: number,
  callbackId: string,
  deps: SessionMenuDeps,
): Promise<boolean> {
  if (data.startsWith('sessionid:')) {
    const selectedSessionId = normalizeSessionIdInput(data.slice('sessionid:'.length));
    const entry = deps.sessionStore.getBySessionId(selectedSessionId);
    const text = formatSessionIdMessage(selectedSessionId, entry?.cwd || deps.getWorkDir(chatId));

    if (deps.client.sendMessage) {
      await deps.client.sendMessage(chatId, text);
    } else {
      await deps.client.editButtons(chatId, msgId, text, []);
    }
    await deps.client.answerCallback?.(callbackId, 'Sent session ID');
    return true;
  }

  if (!data.startsWith('session:')) return false;

  const result = await attachSessionById(data.slice('session:'.length), chatId, deps);
  await deps.client.editButtons(chatId, msgId, result.message, []);
  await deps.client.answerCallback?.(callbackId, result.callbackText, result.showAlert);

  return true;
}
