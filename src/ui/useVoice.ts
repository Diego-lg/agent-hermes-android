/**
 * useVoice — one hook the screens share for the MiniMax Voice Assistant.
 *
 * Responsibilities:
 *   - resolve MiniMax credentials (provider config first, legacy AI config
 *     second) so TTS / cloning work wherever the key was entered
 *   - load + persist VoiceSettings (speech model, voice, prosody, clones)
 *   - speak(text)     : MiniMax T2A -> native playback
 *   - cloneFromFile() : upload + register a cloned voice, then remember it
 *   - listen()        : on-device STT for voice-to-voice, returning a transcript
 *
 * It reads app state via useApp() but does NOT write to AppContext, keeping the
 * blast radius small and the voice feature self-contained.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {useApp} from './AppContext';
import {makeVoiceStore, VoiceSettings, DEFAULT_VOICE_SETTINGS, ClonedVoice} from '../api/voiceStore';
import {
  MinimaxCreds, t2aUrl, isMinimaxModelId,
  uploadCloneFile, cloneVoice, makeCloneVoiceId, CloneFile,
  listVoices, VoiceInfo,
} from '../api/minimaxVoice';
import * as audio from '../api/audioBridge';

const store = makeVoiceStore();

/** Map Android SpeechRecognizer RMS dB (~ -2..10) to a 0..1 amplitude. */
function normalizeDb(raw: number): number {
  const v = (raw + 2) / 12;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface UseVoice {
  settings: VoiceSettings;
  ready: boolean;                       // MiniMax creds present -> TTS/clone usable
  minimaxSelected: boolean;             // active chat model is a MiniMax model
  audioAvailable: boolean;              // native playback/record linked
  sttAvailable: boolean;                // native speech-to-text linked
  speaking: boolean;
  listening: boolean;
  micLevel: number;                     // 0..1 smoothed live mic amplitude
  transcript: string;
  lastError: string | null;
  allVoices: VoiceInfo[];               // full fetched voice catalog (system + cloned + generated)
  voicesLoading: boolean;
  voicesError: string | null;
  refreshVoices: () => Promise<void>;
  patch: <K extends keyof VoiceSettings>(k: K, v: VoiceSettings[K]) => void;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  cloneFromFile: (file: CloneFile, label?: string, previewText?: string) => Promise<{ok: boolean; error?: string; voiceId?: string}>;
  removeClone: (voiceId: string) => Promise<void>;
  startListening: (opts?: {onFinal?: (text: string) => void}) => Promise<void>;
  stopListening: () => Promise<void>;
}

export function resolveMinimaxCreds(
  providerConfigs: Record<string, any>,
  config: {modelApiKey?: string; modelBaseUrl?: string; modelGroupId?: string},
): MinimaxCreds | null {
  const mm = providerConfigs?.MiniMax;
  const apiKey = (mm?.apiKey || config.modelApiKey || '').trim();
  if (!apiKey) return null;
  const baseUrl = (mm?.baseUrl || config.modelBaseUrl || 'https://api.minimax.io/v1').trim();
  const groupId = (mm?.groupId || config.modelGroupId || '').trim() || undefined;
  return {apiKey, baseUrl, groupId};
}

export function useVoice(): UseVoice {
  const {providerConfigs, config, chatOptions} = useApp();
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const finalCb = useRef<((t: string) => void) | null>(null);
  const lastVolTs = useRef(0);
  const decayTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearDecay = useCallback(() => {
    if (decayTimer.current) { clearInterval(decayTimer.current); decayTimer.current = null; }
  }, []);
  // Ensure the decay timer never leaks.
  useEffect(() => () => { if (decayTimer.current) clearInterval(decayTimer.current); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await store.load();
      if (!cancelled) setSettings(s);
    })();
    return () => { cancelled = true; };
  }, []);

  const creds = resolveMinimaxCreds(providerConfigs, config);
  const ready = !!creds;
  const minimaxSelected =
    isMinimaxModelId(chatOptions?.model) ||
    (config.engineMode === 'minimax') ||
    isMinimaxModelId(config.modelId);

  const patch = useCallback(<K extends keyof VoiceSettings>(k: K, v: VoiceSettings[K]) => {
    setSettings(prev => {
      const next = {...prev, [k]: v};
      void store.save(next);
      return next;
    });
  }, []);

  const stopSpeaking = useCallback(async () => {
    await audio.stopPlayback();
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string) => {
    setLastError(null);
    if (!creds) { setLastError('Add your MiniMax API key first.'); return; }
    const clean = (text ?? '').trim();
    if (!clean) return;
    if (!audio.isAudioAvailable()) {
      setLastError('Audio playback unavailable — rebuild the app after installing native modules.');
      return;
    }
    setSpeaking(true);
    try {
      const res = await t2aUrl(creds, {
        text: clean.slice(0, 9800),
        model: settings.speechModel,
        voiceId: settings.voiceId,
        speed: settings.speed,
        vol: settings.vol,
        pitch: settings.pitch,
        emotion: settings.emotion,
        languageBoost: settings.languageBoost,
        format: 'mp3',
      });
      if (!res.ok) { setLastError(res.error); setSpeaking(false); return; }
      await audio.playUrl(res.url);
    } catch (e: any) {
      setLastError(e?.message ?? String(e));
    } finally {
      setSpeaking(false);
    }
  }, [creds, settings]);

  const cloneFromFile = useCallback(async (file: CloneFile, label?: string, previewText?: string) => {
    setLastError(null);
    if (!creds) { const e = 'Add your MiniMax API key first.'; setLastError(e); return {ok: false, error: e}; }
    const up = await uploadCloneFile(creds, file, 'voice_clone');
    if (!up.ok) { setLastError(up.error); return {ok: false, error: up.error}; }
    const voiceId = makeCloneVoiceId();
    const cl = await cloneVoice(creds, {
      fileId: up.fileId,
      voiceId,
      previewText: previewText?.trim() || undefined,
      model: settings.speechModel,
    });
    if (!cl.ok) { setLastError(cl.error); return {ok: false, error: cl.error}; }
    const clone: ClonedVoice = {
      voiceId: cl.voiceId,
      label: label?.trim() || file.name || 'Cloned voice',
      sourceName: file.name,
      createdAt: Date.now(),
      demoUrl: cl.demoUrl,
    };
    const next = await store.addClone(clone);
    setSettings(next);
    return {ok: true, voiceId: cl.voiceId};
  }, [creds, settings.speechModel]);

  const removeClone = useCallback(async (voiceId: string) => {
    const next = await store.removeClone(voiceId);
    setSettings(next);
  }, []);

  const startListening = useCallback(async (opts?: {onFinal?: (text: string) => void}) => {
    setLastError(null);
    if (!audio.isSttAvailable()) {
      setLastError('Speech recognition unavailable — rebuild the app after installing native modules.');
      return;
    }
    finalCb.current = opts?.onFinal ?? null;
    setTranscript('');
    setMicLevel(0);
    try {
      await audio.startListening({
        onPartial: t => setTranscript(t),
        onResult: t => {
          setTranscript(t);
          finalCb.current?.(t);
        },
        onVolume: raw => {
          lastVolTs.current = Date.now();
          const lvl = Math.round(normalizeDb(raw) * 20) / 20; // quantize to reduce churn
          setMicLevel(prev => (Math.abs(prev - lvl) >= 0.05 ? lvl : prev));
        },
        onError: msg => { setLastError(msg); setListening(false); setMicLevel(0); clearDecay(); },
        onEnd: () => { setListening(false); setMicLevel(0); clearDecay(); },
      });
      setListening(true);
      // Decay the level toward 0 when volume events go quiet (silence/pauses).
      clearDecay();
      decayTimer.current = setInterval(() => {
        if (Date.now() - lastVolTs.current < 180) return;
        setMicLevel(prev => (prev <= 0.05 ? 0 : Math.round(prev * 0.55 * 20) / 20));
      }, 120);
    } catch (e: any) {
      setLastError(e?.message ?? String(e));
      setListening(false);
      setMicLevel(0);
      clearDecay();
    }
  }, [clearDecay]);

  const stopListening = useCallback(async () => {
    await audio.stopListening();
    setListening(false);
    setMicLevel(0);
    clearDecay();
  }, [clearDecay]);

  const refreshVoices = useCallback(async () => {
    if (!creds) { setVoicesError('Add your MiniMax API key first.'); return; }
    setVoicesLoading(true);
    setVoicesError(null);
    const res = await listVoices(creds);
    if (res.ok) setAllVoices(res.voices);
    else setVoicesError(res.error);
    setVoicesLoading(false);
  }, [creds]);

  return {
    settings, ready, minimaxSelected,
    audioAvailable: audio.isAudioAvailable(),
    sttAvailable: audio.isSttAvailable(),
    speaking, listening, micLevel, transcript, lastError,
    allVoices, voicesLoading, voicesError, refreshVoices,
    patch, speak, stopSpeaking, cloneFromFile, removeClone,
    startListening, stopListening,
  };
}
