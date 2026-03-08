/**
 * ReasoningLaneCoordinator — manages separate thinking and answer streams.
 *
 * Ported from OpenClaw's reasoning lane architecture:
 *   - reasoning-lane-coordinator.ts (thinking/answer splitting)
 *   - lane-delivery.ts (per-lane state tracking, generation management)
 *   - bot-message-dispatch.ts (lane lifecycle in streaming dispatch)
 *
 * Original: https://github.com/AustenStone/openclaw
 * License: MIT
 * Adapted for copilot-remote by Tag (tag@austen.info), 2026-03-08.
 *
 * Key differences from OpenClaw:
 *   - No Telegram draft-stream dependency; uses simple callbacks
 *   - No code-region-aware tag parsing (copilot-remote gets structured deltas)
 *   - Caller owns message send/edit/delete; coordinator manages text state only
 */

/** Callbacks for the thinking lane's separate message lifecycle. */
export interface ReasoningLaneCallbacks {
  /** Called when thinking text updates. Caller should send/edit the thinking message. */
  onThinkingUpdate(text: string): void;
  /** Called on transition. Caller should delete the thinking message. */
  onThinkingDelete(): void;
}

export interface ReasoningLaneOptions {
  /** When true, thinking streams to a separate message via callbacks. */
  showThinking: boolean;
  /** Required when showThinking is true. */
  callbacks?: ReasoningLaneCallbacks;
}

/**
 * Manages the text state for two parallel "lanes" — thinking and answer —
 * with a one-way transition from thinking to answer phase.
 *
 * Mirrors OpenClaw's lane architecture:
 *   - Each lane accumulates text independently
 *   - A generation counter tracks transition boundaries (like streamGeneration in copilot-remote)
 *   - The thinking lane can be displayed separately or inline
 *   - On transition, the thinking message is cleaned up
 */
export class ReasoningLaneCoordinator {
  // ── Lane state (mirrors OpenClaw's DraftLaneState per lane) ──
  private thinkingText = '';
  private answerText = '';

  // ── Display metadata (answer lane decorations) ──
  private intent = '';
  private toolLines: string[] = [];
  private toolStatus = '';

  // ── Lifecycle (mirrors OpenClaw's reasoningStepState + streamGeneration) ──
  private generation = 0;
  private transitioned = false;

  private readonly showThinking: boolean;
  private readonly callbacks?: ReasoningLaneCallbacks;

  constructor(opts: ReasoningLaneOptions) {
    this.showThinking = opts.showThinking;
    this.callbacks = opts.callbacks;
  }

  // ── Mutators ──────────────────────────────────────────────

  /** Append text to the thinking lane. Fires callback when showThinking is on. */
  updateThinking(text: string): void {
    if (this.transitioned) return; // Post-transition thinking is dropped
    this.thinkingText += text;
    if (this.showThinking && this.callbacks) {
      this.callbacks.onThinkingUpdate(this.renderThinking());
    }
  }

  /** Append text to the answer lane. Auto-transitions if still in thinking phase. */
  updateAnswer(text: string): void {
    if (!this.transitioned && this.thinkingText) {
      this.transitionToAnswer();
    }
    this.answerText += text;
  }

  setIntent(text: string): void {
    this.intent = text;
  }

  addToolLine(line: string): void {
    this.toolLines.push(line);
  }

  setToolStatus(status: string): void {
    this.toolStatus = status;
  }

  // ── Accessors ─────────────────────────────────────────────

  getAnswerText(): string {
    return this.answerText;
  }

  getThinkingText(): string {
    return this.thinkingText;
  }

  /** Stream generation counter — bumped on thinking→answer transition. */
  getGeneration(): number {
    return this.generation;
  }

  hasTransitioned(): boolean {
    return this.transitioned;
  }

  // ── Rendering ─────────────────────────────────────────────

  /**
   * Render the main (answer) message content.
   *
   * Layout mirrors copilot-remote's existing display() in handleMessage:
   *   1. Intent headline (if set)
   *   2. Tool progress lines
   *   3. Inline thinking (only when showThinking is OFF and pre-transition)
   *   4. Active tool status (only when no answer text yet)
   *   5. Answer text
   */
  display(): string {
    const parts: string[] = [];

    if (this.intent) parts.push(`🎯 ${this.intent}`);
    for (const line of this.toolLines) parts.push(line);

    // Inline thinking: shown in main message only when there's no separate thinking message
    if (!this.showThinking && this.thinkingText && !this.transitioned) {
      const s = truncateThinking(this.thinkingText);
      parts.push(`💭 ${s}`);
    }

    if (this.toolStatus && !this.answerText) parts.push(`⏳ ${this.toolStatus}`);
    if (this.answerText) parts.push(this.answerText);

    return parts.join('\n');
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Transition from thinking to answer phase.
   *
   * Mirrors OpenClaw's lane rotation + streamGeneration bump:
   *   - Bumps generation so callers can detect stale renders
   *   - Deletes the separate thinking message if one was active
   *   - Idempotent (safe to call multiple times)
   */
  transitionToAnswer(): void {
    if (this.transitioned) return;
    this.transitioned = true;
    this.generation++;

    if (this.showThinking && this.thinkingText && this.callbacks) {
      this.callbacks.onThinkingDelete();
    }
  }

  /** Reset all state. Call when the coordinator is no longer needed. */
  cleanup(): void {
    this.thinkingText = '';
    this.answerText = '';
    this.intent = '';
    this.toolLines = [];
    this.toolStatus = '';
  }

  // ── Private ───────────────────────────────────────────────

  private renderThinking(): string {
    return `💭 ${truncateThinking(this.thinkingText)}`;
  }
}

/** Truncate thinking text to last 300 chars with ellipsis prefix. */
function truncateThinking(text: string, maxLen = 300): string {
  return text.length > maxLen ? '...' + text.slice(-maxLen) : text;
}
