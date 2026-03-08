import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReasoningLaneCoordinator } from '../reasoning-lane.js';

describe('ReasoningLaneCoordinator', () => {
  describe('showThinking OFF (inline mode)', () => {
    it('shows thinking inline in display()', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.updateThinking('hmm let me think');
      assert.equal(c.display(), '💭 hmm let me think');
    });

    it('hides thinking after transition', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.updateThinking('thinking...');
      c.updateAnswer('Hello!');
      assert.equal(c.display(), 'Hello!');
      assert.equal(c.hasTransitioned(), true);
    });

    it('does not fire callbacks', () => {
      let called = false;
      const c = new ReasoningLaneCoordinator({
        showThinking: false,
        callbacks: {
          onThinkingUpdate: () => { called = true; },
          onThinkingDelete: () => { called = true; },
        },
      });
      c.updateThinking('test');
      c.transitionToAnswer();
      assert.equal(called, false);
    });
  });

  describe('showThinking ON (separate message mode)', () => {
    it('fires onThinkingUpdate on each thinking chunk', () => {
      const updates: string[] = [];
      const c = new ReasoningLaneCoordinator({
        showThinking: true,
        callbacks: {
          onThinkingUpdate: (t) => updates.push(t),
          onThinkingDelete: () => {},
        },
      });
      c.updateThinking('chunk1');
      c.updateThinking(' chunk2');
      assert.equal(updates.length, 2);
      assert.match(updates[1]!, /chunk1 chunk2/);
    });

    it('fires onThinkingDelete on transition', () => {
      let deleted = false;
      const c = new ReasoningLaneCoordinator({
        showThinking: true,
        callbacks: {
          onThinkingUpdate: () => {},
          onThinkingDelete: () => { deleted = true; },
        },
      });
      c.updateThinking('thinking...');
      c.transitionToAnswer();
      assert.equal(deleted, true);
    });

    it('does not show thinking inline in display()', () => {
      const c = new ReasoningLaneCoordinator({
        showThinking: true,
        callbacks: { onThinkingUpdate: () => {}, onThinkingDelete: () => {} },
      });
      c.updateThinking('secret thoughts');
      assert.equal(c.display(), '');
    });
  });

  describe('generation tracking', () => {
    it('starts at 0 and bumps on transition', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      assert.equal(c.getGeneration(), 0);
      c.updateThinking('think');
      c.transitionToAnswer();
      assert.equal(c.getGeneration(), 1);
    });

    it('transition is idempotent', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.updateThinking('think');
      c.transitionToAnswer();
      c.transitionToAnswer();
      assert.equal(c.getGeneration(), 1);
    });
  });

  describe('auto-transition', () => {
    it('updateAnswer auto-transitions when thinking exists', () => {
      let deleted = false;
      const c = new ReasoningLaneCoordinator({
        showThinking: true,
        callbacks: {
          onThinkingUpdate: () => {},
          onThinkingDelete: () => { deleted = true; },
        },
      });
      c.updateThinking('think');
      c.updateAnswer('answer');
      assert.equal(deleted, true);
      assert.equal(c.getGeneration(), 1);
    });

    it('updateAnswer without prior thinking does not bump generation', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.updateAnswer('direct answer');
      assert.equal(c.getGeneration(), 0);
      assert.equal(c.hasTransitioned(), false);
    });
  });

  describe('display layout', () => {
    it('renders intent + tool lines + tool status + answer', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.setIntent('Searching...');
      c.addToolLine('🔍 web_search("foo")');
      c.setToolStatus('Running search');
      assert.equal(c.display(), '🎯 Searching...\n🔍 web_search("foo")\n⏳ Running search');
    });

    it('tool status hidden once answer text arrives', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.setToolStatus('Running');
      c.updateAnswer('Result');
      assert.equal(c.display(), 'Result');
    });
  });

  describe('thinking truncation', () => {
    it('truncates thinking over 300 chars', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.updateThinking('x'.repeat(500));
      const d = c.display();
      assert.match(d, /^💭 \.\.\./);
      // 💭 + space + ... + 300 chars
      assert.ok(d.length < 320);
    });
  });

  describe('post-transition thinking is dropped', () => {
    it('ignores updateThinking after transition', () => {
      const updates: string[] = [];
      const c = new ReasoningLaneCoordinator({
        showThinking: true,
        callbacks: {
          onThinkingUpdate: (t) => updates.push(t),
          onThinkingDelete: () => {},
        },
      });
      c.updateThinking('before');
      c.transitionToAnswer();
      const countBefore = updates.length;
      c.updateThinking('after');
      assert.equal(updates.length, countBefore);
      assert.equal(c.getThinkingText(), 'before');
    });
  });

  describe('cleanup', () => {
    it('resets all state', () => {
      const c = new ReasoningLaneCoordinator({ showThinking: false });
      c.updateThinking('t');
      c.updateAnswer('a');
      c.setIntent('i');
      c.addToolLine('l');
      c.setToolStatus('s');
      c.cleanup();
      assert.equal(c.getThinkingText(), '');
      assert.equal(c.getAnswerText(), '');
      assert.equal(c.display(), '');
    });
  });
});
