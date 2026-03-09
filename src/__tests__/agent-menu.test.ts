import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, type ChatConfig } from '../config-store.js';
import { handleAgentCallback } from '../agent-menu.js';

function createDeps(initialConfig?: Partial<ChatConfig>) {
  const state = {
    config: {
      ...DEFAULT_CONFIG,
      ...initialConfig,
      autoApprove: { ...DEFAULT_CONFIG.autoApprove, ...(initialConfig?.autoApprove ?? {}) },
    } satisfies ChatConfig,
  };

  const client = {
    editButtonsCalls: [] as Array<Record<string, unknown>>,
    answerCallbackCalls: [] as Array<Record<string, unknown>>,
    async editButtons(chatId: string, msgId: number, text: string, buttons: unknown[][]) {
      this.editButtonsCalls.push({ chatId, msgId, text, buttons });
    },
    async answerCallback(callbackId: string, text?: string) {
      this.answerCallbackCalls.push({ callbackId, text });
    },
  };

  const configStore = {
    set: (_key: string, updates: Partial<ChatConfig>) => {
      state.config = {
        ...state.config,
        ...updates,
        autoApprove: { ...state.config.autoApprove, ...(updates.autoApprove ?? {}) },
      };
      return state.config;
    },
  };

  return {
    state,
    client,
    deps: {
      client,
      configStore,
      sessions: new Map<string, { alive?: boolean; selectAgent?: (name: string) => Promise<void>; deselectAgent?: () => Promise<void> }>(),
      getSession: async () => ({ alive: false }),
    },
  };
}

describe('handleAgentCallback', () => {
  it('selects an agent for an active session', async () => {
    const { client, deps } = createDeps();
    const calls: string[] = [];
    deps.sessions.set('chat-1', {
      alive: true,
      selectAgent: async (name: string) => {
        calls.push(name);
      },
    });

    const handled = await handleAgentCallback('agent:notes', 'chat-1', 12, 'cb-1', deps);

    assert.equal(handled, true);
    assert.deepEqual(calls, ['notes']);
    assert.equal(client.editButtonsCalls[0]?.text, '🤖 Agent: `notes`');
    assert.deepEqual(client.answerCallbackCalls[0], { callbackId: 'cb-1', text: 'Agent set: notes' });
  });

  it('creates or reuses a live session and selects the agent immediately', async () => {
    const { client, deps } = createDeps();
    const calls: string[] = [];
    deps.getSession = async () => ({
      alive: true,
      selectAgent: async (name: string) => {
        calls.push(name);
      },
    });

    const handled = await handleAgentCallback('agent:notes', 'chat-1', 12, 'cb-2', deps);

    assert.equal(handled, true);
    assert.deepEqual(calls, ['notes']);
    assert.equal(client.editButtonsCalls[0]?.text, '🤖 Agent: `notes`');
  });

  it('stores the agent for the next session only when no live session can be obtained', async () => {
    const { state, client, deps } = createDeps();

    const handled = await handleAgentCallback('agent:notes', 'chat-1', 12, 'cb-2', deps);

    assert.equal(handled, true);
    assert.equal(state.config.agent, 'notes');
    assert.equal(client.editButtonsCalls[0]?.text, '🤖 Agent for next session: `notes`');
  });

  it('deselects the active session agent', async () => {
    const { client, deps } = createDeps();
    let deselected = false;
    deps.sessions.set('chat-1', {
      alive: true,
      deselectAgent: async () => {
        deselected = true;
      },
    });

    const handled = await handleAgentCallback('agent:__deselect__', 'chat-1', 12, 'cb-3', deps);

    assert.equal(handled, true);
    assert.equal(deselected, true);
    assert.equal(client.editButtonsCalls[0]?.text, '🤖 Agent cleared for this session.');
  });
});