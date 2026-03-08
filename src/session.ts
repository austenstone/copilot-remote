// ============================================================
// Copilot Remote — Session Manager
// ============================================================
// Spawns Copilot CLI per-prompt in non-interactive mode.
// Each message = one copilot invocation with streaming output.
// ============================================================

import * as pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { EventEmitter } from 'events';
import * as fs from 'fs';

export interface SessionOptions {
  cwd: string;
  binary?: string;
  env?: Record<string, string>;
}

export class CopilotSession extends EventEmitter {
  private proc: pty.IPty | null = null;
  private _alive = false;
  private _busy = false;
  private cwd!: string;
  private binary!: string;
  private sessionEnv!: Record<string, string>;

  constructor() {
    super();
  }

  get alive(): boolean {
    return this._alive;
  }

  get busy(): boolean {
    return this._busy;
  }

  async start(options: SessionOptions): Promise<void> {
    if (!fs.existsSync(options.cwd)) {
      throw new Error('Working directory does not exist: ' + options.cwd);
    }

    this.cwd = options.cwd;
    this.binary = options.binary ?? 'copilot';
    this.sessionEnv = { ...process.env, ...options.env } as Record<string, string>;
    this._alive = true;

    console.log('[Session] Ready — binary: ' + this.binary + ', cwd: ' + this.cwd);
  }

  async send(prompt: string): Promise<string> {
    if (!this._alive) {
      throw new Error('Session not started');
    }
    if (this._busy) {
      throw new Error('Session is busy processing a prompt');
    }

    this._busy = true;
    const userShell = process.env.SHELL ?? '/bin/zsh';

    // Build command: copilot -p "prompt" with TUI disabled
    const escaped = prompt.replace(/'/g, "'\\''");
    const cmd = this.binary + " -p '" + escaped + "' --no-alt-screen --no-color -s --allow-all-tools";

    console.log('[Session] Running: ' + cmd.slice(0, 100) + '...');

    return new Promise((resolve, reject) => {
      let output = '';
      let lastChunk = '';

      try {
        this.proc = pty.spawn(userShell, ['-l', '-c', cmd], {
          name: 'dumb',
          cols: 120,
          rows: 40,
          cwd: this.cwd,
          env: this.sessionEnv,
        });
      } catch (err) {
        this._busy = false;
        reject(err);
        return;
      }

      console.log('[Session] Spawned pid: ' + this.proc.pid);

      this.proc.onData((data: string) => {
        const cleaned = stripAnsi(data);
        output += cleaned;
        lastChunk = cleaned;

        // Emit chunks for streaming to Telegram
        if (cleaned.trim()) {
          this.emit('output', cleaned);
        }
      });

      this.proc.onExit(({ exitCode }) => {
        console.log('[Session] Prompt finished, exit code: ' + exitCode);
        this._busy = false;
        this.proc = null;

        const response = output.trim();
        if (exitCode === 0 || response) {
          resolve(response);
        } else {
          reject(new Error('Copilot exited with code ' + exitCode));
        }
      });
    });
  }

  approve(): void {
    this.proc?.write('y\r');
  }

  deny(): void {
    this.proc?.write('n\r');
  }

  resize(cols: number, rows: number): void {
    this.proc?.resize(cols, rows);
  }

  kill(): void {
    this._alive = false;
    this._busy = false;
    this.proc?.kill();
    this.proc = null;
  }
}
