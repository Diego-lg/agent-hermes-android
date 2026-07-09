/**
 * groupChat — engine-agnostic orchestration for a moderated multi-agent
 * discussion. Pure TS: no React, no direct engine/network imports. The caller
 * injects a `runTurn` function that performs one streaming completion, so this
 * module works with the desktop Hermes engine, the MiniMax cloud engine, or a
 * test stub, and stays testable in Node.
 *
 * Guarantees:
 *   - Strictly serialized: exactly one participant streams at a time. Turns are
 *     awaited one after another; nothing runs in parallel.
 *   - A shared transcript is tagged by speaker name and rendered as
 *     "[Name]: text" into every agent's prompt, alongside its own system prompt
 *     and a stay-in-character / be-concise rule.
 *   - round_robin: participants speak in order each round.
 *     moderated: one extra lightweight director call picks the next speaker id,
 *     falling back to round-robin on any parse failure.
 *   - Total rounds are capped; each agent's transcript context is trimmed to a
 *     max character budget.
 *   - Callback API: onSpeakerStart / onDelta / onSpeakerDone / onRoundEnd /
 *     onError. Abort is supported mid-turn.
 */
import {GroupMode, MAX_ROUNDS} from './personalityStore';

/** The lean view of a personality the orchestrator needs. The UI maps a full
 *  Personality (icon/color/voice) down to this. */
export interface GroupParticipant {
  id: string;
  name: string;
  systemPrompt: string;
  /** Optional per-turn model override, passed straight to runTurn. */
  modelId?: string;
}

export interface TranscriptEntry {
  /** Display name of the speaker ('You' for the user). */
  speaker: string;
  /** Personality id, or 'user' for user interjections. */
  participantId: string;
  text: string;
  ts: number;
}

/** Args handed to the injected streaming function for a single turn. */
export interface RunTurnArgs {
  /** Full system prompt for this agent (persona + shared rules). */
  system: string;
  /** The user-role content: the rendered transcript + turn instruction. */
  user: string;
  /** Model id to use, if the agent pinned one. */
  model?: string;
  /** Aborts the in-flight request when the group run is aborted. */
  signal: AbortSignal;
  /** Called with each streamed text chunk (may be called once with all of it). */
  onDelta: (chunk: string) => void;
}

/** Performs one streaming completion and resolves with the full text. */
export type RunTurn = (args: RunTurnArgs) => Promise<string>;

export interface GroupChatCallbacks {
  onSpeakerStart?: (p: GroupParticipant) => void;
  onDelta?: (chunk: string) => void;
  onSpeakerDone?: (p: GroupParticipant, fullText: string) => void;
  onRoundEnd?: (round: number) => void;
  onError?: (err: Error, p?: GroupParticipant) => void;
}

export interface GroupChatConfig {
  participants: GroupParticipant[];
  mode: GroupMode;
  runTurn: RunTurn;
  callbacks?: GroupChatCallbacks;
  /** Per-agent transcript context budget (chars). Default 6000. */
  maxContextChars?: number;
}

/* ---------- Prompt composition ---------- */

const CONCISE_RULES =
  "You are taking part in a live group discussion. Rules: stay fully in character; " +
  "keep it short — a few sentences, no monologues; respond directly to what others " +
  "just said and, if you disagree, say so plainly and say why; do not repeat points " +
  "already made; never write another participant's lines, use stage directions, or " +
  "narrate your own actions. Speak only as yourself.";

function composeSystem(p: GroupParticipant): string {
  return `${p.systemPrompt}\n\n${CONCISE_RULES}\n\nYou are "${p.name}". Sign nothing; just speak.`;
}

/** Render the transcript as "[Name]: text", trimmed to the tail that fits the
 *  budget so long discussions don't blow the context window. */
function renderTranscript(entries: TranscriptEntry[], budget: number): string {
  const lines = entries.map(e => `[${e.speaker}]: ${e.text}`);
  let out = lines.join('\n\n');
  if (out.length <= budget) return out;
  // Keep the most recent turns within budget.
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 2;
    if (used + cost > budget) break;
    kept.unshift(lines[i]);
    used += cost;
  }
  return `[…earlier turns omitted…]\n\n${kept.join('\n\n')}`;
}

function composeUser(p: GroupParticipant, entries: TranscriptEntry[], budget: number): string {
  if (entries.length === 0) {
    return `You are opening the discussion. Give your first contribution as "${p.name}".`;
  }
  const transcript = renderTranscript(entries, budget);
  return `Discussion so far:\n\n${transcript}\n\nIt is your turn, "${p.name}". Give your next contribution.`;
}

/* ---------- Orchestrator ---------- */

export class GroupChat {
  private participants: GroupParticipant[];
  private mode: GroupMode;
  private runTurn: RunTurn;
  private cb: GroupChatCallbacks;
  private budget: number;

  private transcript: TranscriptEntry[] = [];
  private rrIndex = 0;
  private controller: AbortController | null = null;
  private _running = false;

  constructor(config: GroupChatConfig) {
    this.participants = config.participants.slice(0, 8);
    this.mode = config.mode;
    this.runTurn = config.runTurn;
    this.cb = config.callbacks ?? {};
    this.budget = config.maxContextChars ?? 6000;
  }

  get running(): boolean {
    return this._running;
  }

  getTranscript(): TranscriptEntry[] {
    return this.transcript.slice();
  }

  /** Replace the whole transcript (e.g. when resuming a saved run). */
  setTranscript(entries: TranscriptEntry[]): void {
    this.transcript = entries.slice();
  }

  /** Add a user interjection to the shared transcript. */
  addUserMessage(text: string, name = 'You'): void {
    const t = text.trim();
    if (!t) return;
    this.transcript.push({speaker: name, participantId: 'user', text: t, ts: Date.now()});
  }

  /** Update the roster in place (participant edits between runs). */
  setParticipants(participants: GroupParticipant[]): void {
    this.participants = participants.slice(0, 8);
    if (this.rrIndex >= this.participants.length) this.rrIndex = 0;
  }

  abort(): void {
    this._running = false;
    this.controller?.abort();
    this.controller = null;
  }

  private byId(id: string): GroupParticipant | undefined {
    return this.participants.find(p => p.id === id);
  }

  /** Run one participant's turn end-to-end (serialized). Returns the text, or
   *  null if aborted / errored. */
  private async runOneTurn(p: GroupParticipant): Promise<string | null> {
    if (!this.controller) this.controller = new AbortController();
    const signal = this.controller.signal;
    if (signal.aborted) return null;
    this.cb.onSpeakerStart?.(p);
    try {
      const text = await this.runTurn({
        system: composeSystem(p),
        user: composeUser(p, this.transcript, this.budget),
        model: p.modelId,
        signal,
        onDelta: chunk => this.cb.onDelta?.(chunk),
      });
      const clean = (text ?? '').trim();
      if (signal.aborted) return null;
      const entry: TranscriptEntry = {
        speaker: p.name,
        participantId: p.id,
        text: clean || '(no response)',
        ts: Date.now(),
      };
      this.transcript.push(entry);
      this.cb.onSpeakerDone?.(p, entry.text);
      return entry.text;
    } catch (e: any) {
      if (signal.aborted || e?.name === 'AbortError') return null;
      this.cb.onError?.(e instanceof Error ? e : new Error(String(e)), p);
      return null;
    }
  }

  /** moderated mode: ask the director which participant speaks next. Falls back
   *  to plain round-robin on any failure or unparseable reply. */
  private async pickNext(): Promise<GroupParticipant> {
    const fallback = () => this.participants[this.rrIndex % this.participants.length];
    if (this.participants.length <= 1) return this.participants[0];
    try {
      const roster = this.participants
        .map(p => `${p.id} — ${p.name}`)
        .join('\n');
      const system =
        'You are the silent moderator of a panel discussion. Choose who should ' +
        'speak next to keep it productive, balanced, and lively — favour someone ' +
        'who has not spoken recently or who would most sharpen the debate. ' +
        'Reply with ONLY the exact participant id, nothing else.';
      const user =
        `Panelists:\n${roster}\n\nDiscussion so far:\n\n` +
        `${renderTranscript(this.transcript, this.budget)}\n\n` +
        'Who should speak next? Reply with only the id.';
      const reply = (
        await this.runTurn({
          system,
          user,
          signal: this.controller?.signal ?? new AbortController().signal,
          onDelta: () => {},
        })
      ).trim();
      const lower = reply.toLowerCase();
      const byId = this.participants.find(p => lower.includes(p.id.toLowerCase()));
      if (byId) return byId;
      const byName = this.participants.find(p => lower.includes(p.name.toLowerCase()));
      if (byName) return byName;
      return fallback();
    } catch {
      return fallback();
    }
  }

  /** Run autonomous rounds. A "round" is one full pass (participants.length
   *  turns) in BOTH modes, so "continue N rounds" produces comparable volume:
   *  round_robin speaks everyone once in order; moderated lets the director
   *  pick each of those turns. Clamped to MAX_ROUNDS and abortable between and
   *  during turns. */
  async run(rounds: number): Promise<void> {
    const total = Math.max(1, Math.min(Math.floor(rounds) || 1, MAX_ROUNDS));
    if (this.participants.length === 0) return;
    this.controller = new AbortController();
    this._running = true;
    try {
      for (let r = 0; r < total; r++) {
        if (!this._running || this.controller.signal.aborted) break;
        const turns = this.participants.length;
        for (let i = 0; i < turns; i++) {
          if (!this._running || this.controller.signal.aborted) break;
          const p =
            this.mode === 'round_robin'
              ? this.participants[i]
              : await this.pickNext();
          const res = await this.runOneTurn(p);
          if (this.mode !== 'round_robin') {
            const idx = this.participants.indexOf(p);
            this.rrIndex = idx >= 0 ? (idx + 1) % this.participants.length : 0;
          }
          if (res === null && this.controller.signal.aborted) break;
        }
        if (this._running && !this.controller.signal.aborted) this.cb.onRoundEnd?.(r);
      }
    } finally {
      this._running = false;
      this.controller = null;
    }
  }

  /** Force one specific participant to speak once (used for @mentions). */
  async speak(participantId: string): Promise<void> {
    const p = this.byId(participantId);
    if (!p) return;
    this.controller = new AbortController();
    this._running = true;
    try {
      await this.runOneTurn(p);
    } finally {
      this._running = false;
      this.controller = null;
    }
  }
}
