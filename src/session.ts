// ============================================================
// Copilot Remote — PTY Session Manager
// ============================================================
// Spawns and manages a Copilot CLI session in a pseudo-terminal.
// Handles input/output, ANSI stripping, and response detection.
// ============================================================

import * as pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { EventEmitter } from 'events';
import * as fs from 'fs';

export interface SessionOptions {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
}

export class CopilotSession extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private buffer = '';
  private responseBuffer = '';
  private collecting = false;
  private collectTimer: NodeJS.Timeout | null = null;
  private _alive = false;

  private static PROMPT_PATTERNS = [
    /❯\s*$/,
    /copilot>\s*$/,
    /\?\s*\(y\/n\)\s*$/i,
    /\?\s*$/,
    />\s*$/,
  ];

  private static STREAMING_PATTERNS = [
    /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
    /thinking\.\.\./i,
    /running\.\.\./i,
  ];

  get alive(): boolean {
    return this._alive;
  }

  async start(options: SessionOptions): Promise<void> {
    const copilotBin = options.shell ?? 'copilot';
    const userShell = process.env.SHELL ?? '/bin/zsh';

    console.log('[Session] Spawning: ' + userShell + ' -l -c ' + copilotBin);
    console.log('[Session] CWD: ' + options.cwd);

    if (!fs.existsSync(options.cwd)) {
      throw new Error('Working directory does not exist: ' + options.cwd);
    }

    try {
      this.ptyProcess = pty.spawn(userShell, ['-l', '-c', copilotBin], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: options.cwd,
        env: { ...process.env, ...options.env } as Record<string, string>,
      });
    } catch (err) {
      console.error('[Session] pty.spawn failed:', err);
      throw err;
    }

    console.log('[Session] PTY spawned, pid: ' + this.ptyProcess.pid);
    this._alive = true;

    this.ptyProcess.onData((data: string) => {
      const cleaned = stripAnsi(data);
      this.buffer += cleaned;
      console.log('[Session] out: ' + JSON.stringify(cleaned.slice(0, 200)));
      this.emit('output', cleaned);

      if (this.collecting) {
        this.responseBuffer += cleaned;
        this.resetCollectTimer();
      }

      if (this.isPrompt(this.buffer)) {
        if (this.collecting) {
          this.finishCollecting();
        } else {
          this.emit('waiting');
        }
      }
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      console.log('[Session] Process exited with code: ' + exitCode);
      this._alive = false;
      this.emit('exit', exitCode);
    });

    await this.waitForPrompt(30_000);
  }

  send(text: string): void {
    if (!this.ptyProcess || !this._alive) {
      throw new Error('Session not running');
    }

    this.buffer = '';
    this.responseBuffer = '';
    this.collecting = true;

    this.ptyProcess.write(text + '\r');
  }

  approve(): void {
    this.send('y');
  }

  deny(): void {
    this.send('n');
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess?.resize(cols, rows);
  }

  kill(): void {
    this._alive = false;
    this.ptyProcess?.kill();
    this.ptyProcess = null;
  }

  private isPrompt(text: string): boolean {
    const trimmed = text.trimEnd();
    const lastLine = trimmed.split('\n').pop() ?? '';
    return CopilotSession.PROMPT_PATTERNS.some(p => p.test(lastLine));
  }

  private isStreaming(text: string): boolean {
    return CopilotSession.STREAMING_PATTERNS.some(p => p.test(text));
  }

  private resetCollectTimer(): void {
    if (this.collectTimer) {
      clearTimeout(this.collectTimer);
    }
    this.collectTimer = setTimeout(() => {
      if (this.collecting && !this.isStreaming(this.responseBuffer)) {
        this.finishCollecting();
      }
    }, 1500);
  }

  private finishCollecting(): void {
    this.collecting = false;
    if (this.collectTimer) {
      clearTimeout(this.collectTimer);
      this.collectTimer = null;
    }

    const response = this.cleanResponse(this.responseBuffer);
    if (response.trim()) {
      this.emit('response', response);
    }
    this.responseBuffer = '';
  }

  private cleanResponse(raw: string): string {
    const lines = raw.split('\n');
    const content = lines.slice(1);

    while (content.length > 0) {
      const last = content[content.length - 1].trim();
      if (last === '' || last === '❯' || last === '>' || last.endsWith('(y/n)')) {
        content.pop();
      } else {
        break;
      }
    }

    return content.join('\n').trim();
  }

  private waitForPrompt(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for Copilot CLI prompt'));
      }, timeoutMs);

      const check = () => {
        if (this.isPrompt(this.buffer)) {
          clearTimeout(timeout);
          this.removeListener('output', check);
          resolve();
        }
      };

      this.on('output', check);

      if (this.isPrompt(this.buffer)) {
        clearTimeout(timeout);
        this.removeListener('output', check);
        resolve();
      }
    });
  }
}
