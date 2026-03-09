import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../store.js';

describe('SessionStore deterministic IDs', () => {
  it('builds a deterministic session ID for DMs', () => {
    assert.equal(SessionStore.deterministicSessionId('123456789'), 'telegram-123456789');
  });

  it('builds a deterministic session ID for topic chats', () => {
    assert.equal(
      SessionStore.deterministicSessionId('-1001234567890:42'),
      'telegram--1001234567890-thread-42',
    );
  });

  it('can recover the Telegram session key from a deterministic session ID', () => {
    assert.equal(
      SessionStore.sessionKeyFromSessionId('telegram--1001234567890-thread-42'),
      '-1001234567890:42',
    );
    assert.equal(SessionStore.sessionKeyFromSessionId('telegram-123456789'), '123456789');
  });

  it('ignores non-deterministic legacy session IDs', () => {
    assert.equal(SessionStore.sessionKeyFromSessionId('session-abc-123'), null);
  });
});