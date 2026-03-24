import type { Button } from './client.js';
import type { ChatConfig } from './config-store.js';

interface AgentSession {
  alive?: boolean;
  selectAgent?: (name: string) => Promise<unknown>;
  deselectAgent?: () => Promise<unknown>;
}

interface AgentMenuClient {
  editButtons: (chatId: string, msgId: number, text: string, buttons: Button[][]) => Promise<void>;
  answerCallback?: (callbackId: string, text?: string, showAlert?: boolean) => Promise<void>;
}

interface AgentMenuConfigStore {
  set: (key: string, updates: Partial<ChatConfig>, isGlobal?: boolean) => ChatConfig;
}

export interface AgentMenuDeps {
  client: AgentMenuClient;
  configStore: AgentMenuConfigStore;
  sessions: Map<string, AgentSession>;
  getSession: (chatId: string) => Promise<AgentSession>;
}

export async function handleAgentCallback(
  data: string,
  chatId: string,
  msgId: number,
  callbackId: string,
  deps: AgentMenuDeps,
): Promise<boolean> {
  if (!data.startsWith('agent:')) return false;

  const requestedAgent = data.slice('agent:'.length);
  const session = deps.sessions.get(chatId);

  if (requestedAgent === '__deselect__') {
    if (session?.alive) {
      await session.deselectAgent?.();
      await deps.client.editButtons(chatId, msgId, '🤖 Agent cleared for this session.', []);
      await deps.client.answerCallback?.(callbackId, 'Agent cleared');
      return true;
    }

    deps.configStore.set(chatId, { agent: null }, true);
    await deps.client.editButtons(chatId, msgId, '🤖 Default agent cleared for the next session.', []);
    await deps.client.answerCallback?.(callbackId, 'Default agent cleared');
    return true;
  }

  if (session?.alive) {
    await session.selectAgent?.(requestedAgent);
    await deps.client.editButtons(chatId, msgId, '🤖 Agent: `' + requestedAgent + '`', []);
    await deps.client.answerCallback?.(callbackId, 'Agent set: ' + requestedAgent);
    return true;
  }

  try {
    const liveSession = await deps.getSession(chatId);
    if (liveSession?.alive) {
      await liveSession.selectAgent?.(requestedAgent);
      await deps.client.editButtons(chatId, msgId, '🤖 Agent: `' + requestedAgent + '`', []);
      await deps.client.answerCallback?.(callbackId, 'Agent set: ' + requestedAgent);
      return true;
    }
  } catch {
    // Fall through to storing the selection for the next session.
  }

  deps.configStore.set(chatId, { agent: requestedAgent }, true);
  await deps.client.editButtons(chatId, msgId, '🤖 Agent for next session: `' + requestedAgent + '`', []);
  await deps.client.answerCallback?.(callbackId, 'Will use ' + requestedAgent + ' next session');
  return true;
}
