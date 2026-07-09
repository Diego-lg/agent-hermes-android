/**
 * useGroupRunner — bridges the pure-TS group orchestrator to the app's live
 * backend, without touching AppContext.sendPrompt or the engines' core.
 *
 * Strategy for one turn (RunTurn):
 *   1. If a MiniMax key is configured (pickMinimaxCfg), stream a direct
 *      chat-completions call. This honours a per-personality model override,
 *      never pollutes the user's chat sessions, and works whether or not the
 *      desktop server is up.
 *   2. Otherwise, if an engine is connected (desktop Hermes), run through it on
 *      a throwaway session with the system prompt inlined — text-only fallback.
 *
 * Voice: speakAs() uses t2aUrl + the audioBridge, so it degrades to a silent
 * no-op with no key or no native audio module. Callers await it, so playback is
 * strictly sequential and never overlaps.
 */
import {useCallback, useMemo} from 'react';
import {useApp} from './AppContext';
import {pickMinimaxCfg, MinimaxConfig} from '../api/ChatEngine';
import {t2aUrl, DEFAULT_SPEECH_MODEL, Emotion} from '../api/minimaxVoice';
import * as audio from '../api/audioBridge';
import {RunTurn, RunTurnArgs} from '../api/groupChat';

export interface PersonaVoice {
  voiceId?: string;
  speechModel?: string;
  speed?: number;
  emotion?: Emotion;
}

export interface GroupRunner {
  runTurn: RunTurn;
  /** Can we run text turns at all (key or engine present)? */
  hasBackend: boolean;
  /** MiniMax key present → voice + direct streaming available. */
  voiceReady: boolean;
  /** Native audio module linked. */
  audioAvailable: boolean;
  speakAs: (text: string, v: PersonaVoice, signal?: AbortSignal) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  backendLabel: string;
}

/** Extract assistant text from a chat-completions body (SSE or single JSON),
 *  emitting each chunk via onDelta. Mirrors MinimaxEngine's tolerant parser. */
function extractContent(raw: string, onDelta: (c: string) => void): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const j: any = JSON.parse(trimmed);
      const c = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text;
      if (typeof c === 'string' && c) { onDelta(c); return c; }
      if (j?.error) throw new Error(j.error?.message ?? j.error?.code ?? 'Provider error');
    } catch (e: any) {
      if (e?.message && /provider/i.test(e.message)) throw e;
    }
  }
  let acc = '';
  const events = trimmed.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const ev of events) {
    for (const line of ev.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j: any = JSON.parse(data);
        const c =
          j?.choices?.[0]?.delta?.content ??
          j?.choices?.[0]?.message?.content ??
          j?.choices?.[0]?.text ?? '';
        if (typeof c === 'string' && c) { acc += c; onDelta(c); }
      } catch { /* skip heartbeats / comments */ }
    }
  }
  return acc;
}

async function streamMinimax(cfg: MinimaxConfig, args: RunTurnArgs): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
  if (cfg.groupId) headers.GroupId = cfg.groupId;
  const r = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: args.signal,
    headers,
    body: JSON.stringify({
      model: args.model || cfg.model,
      stream: true,
      messages: [
        {role: 'system', content: args.system},
        {role: 'user', content: args.user},
      ],
    }),
  });
  if (!r.ok) {
    const b = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}: ${b.slice(0, 160)}`);
  }
  const raw = await r.text();
  return extractContent(raw, args.onDelta);
}

async function streamViaEngine(engine: any, args: RunTurnArgs): Promise<string> {
  const sid = await engine.createSession('[group]');
  let text = '';
  const handler = (type: string, params: any) => {
    if (params?.session_id && params.session_id !== sid) return;
    if (type === 'message.delta') {
      const t = params.payload?.text ?? '';
      if (t) { text += t; args.onDelta(t); }
    }
  };
  const off = engine.onEvent(handler);
  const prompt = `[System: ${args.system}]\n\n${args.user}`;
  const handle = engine.submitPrompt(prompt, sid, args.model ? {model: args.model} : undefined);
  const onAbort = () => { try { handle.abort(); } catch { /* ignore */ } };
  args.signal.addEventListener('abort', onAbort);
  try {
    const res = await handle.done;
    return (res?.text ?? text) || text;
  } finally {
    off();
    args.signal.removeEventListener('abort', onAbort);
  }
}

export function useGroupRunner(): GroupRunner {
  const {engine, config, providerConfigs} = useApp();
  const cfg = useMemo(() => pickMinimaxCfg(config, providerConfigs), [config, providerConfigs]);

  const runTurn = useCallback<RunTurn>(
    async args => {
      if (cfg) return streamMinimax(cfg, args);
      if (engine) return streamViaEngine(engine, args);
      throw new Error('No MiniMax key and no server connected — add a key in Settings → AI.');
    },
    [cfg, engine],
  );

  const speakAs = useCallback(
    async (text: string, v: PersonaVoice, signal?: AbortSignal) => {
      if (!cfg || !audio.isAudioAvailable()) return; // graceful: text-only
      const clean = (text || '').trim();
      if (!clean || signal?.aborted) return;
      const res = await t2aUrl(
        {apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, groupId: cfg.groupId},
        {
          text: clean.slice(0, 9800),
          model: v.speechModel || DEFAULT_SPEECH_MODEL,
          voiceId: v.voiceId || 'English_expressive_narrator',
          speed: v.speed ?? 1,
          emotion: v.emotion,
          format: 'mp3',
        },
      );
      if (!res.ok || signal?.aborted) return; // swallow TTS errors; text already shown
      await audio.playUrl(res.url);
    },
    [cfg],
  );

  const stopSpeaking = useCallback(() => audio.stopPlayback(), []);

  return {
    runTurn,
    hasBackend: !!cfg || !!engine,
    voiceReady: !!cfg,
    audioAvailable: audio.isAudioAvailable(),
    speakAs,
    stopSpeaking,
    backendLabel: cfg ? 'MiniMax cloud' : engine ? 'Desktop server' : 'No backend',
  };
}
