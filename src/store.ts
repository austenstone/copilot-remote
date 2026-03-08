// Copilot Remote — Persistent session store
// Maps chat IDs to Copilot session IDs for resume across restarts.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface SessionEntry {
  sessionId: string;
  cwd: string;
  model: string;
  summary?: string;
  createdAt: number;
  lastUsed: number;
}

export class SessionStore {
  private data: Record<string, SessionEntry> = {};
  private path: string;

  constructor(storePath?: string) {
    this.path = storePath ?? join(process.env.HOME ?? '/tmp', '.copilot-remote', 'sessions.json');
    this.load();
  }

  get(chatId: string): SessionEntry | undefined {
    return this.data[chatId];
  }

  set(chatId: string, entry: SessionEntry): void {
    this.data[chatId] = entry;
    this.save();
  }

  touch(chatId: string, summary?: string): void {
    if (this.data[chatId]) {
      this.data[chatId].lastUsed = Date.now();
      if (summary && !this.data[chatId].summary) {
        this.data[chatId].summary = summary.slice(0, 80);
      }
      this.save();
    }
  }

  delete(chatId: string): void {
    delete this.data[chatId];
    this.save();
  }

  list(): [string, SessionEntry][] {
    return Object.entries(this.data).sort((a, b) => b[1].lastUsed - a[1].lastUsed);
  }

  private load(): void {
    try {
      this.data = JSON.parse(readFileSync(this.path, 'utf-8'));
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch {
      /* ignore */
    }
  }
}
