import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverAgents } from '../agent-discovery.js';

describe('discoverAgents', () => {
  it('finds workspace agent files in .github/agents', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-remote-agents-'));
    const agentsDir = path.join(tempDir, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'notes.agent.md'),
      `---\ndescription: \"Notes agent\"\ntools: [read, search]\nname: notes\nuser-invocable: true\n---\n\n# Notes agent\n\nTake notes.\n`,
      'utf8',
    );

    try {
      const origHome = process.env.HOME;
      process.env.HOME = tempDir; // isolate from global agents
      const agents = discoverAgents(tempDir);
      process.env.HOME = origHome;
      assert.equal(agents.length, 1);
      assert.equal(agents[0]?.name, 'notes');
      assert.equal(agents[0]?.description, 'Notes agent');
      assert.match(agents[0]?.source ?? '', /notes\.agent\.md$/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
