/**
 * voiceStore — persistence for the MiniMax Voice Assistant.
 *
 * Holds the selected speech (TTS) model, the active voice_id (system or
 * cloned), prosody knobs, the registered cloned-voice metadata, and the
 * per-app toggles (auto-speak replies, voice-assistant mode default).
 *
 * Local-only, backed by the same AsyncStorage shim as the rest of the app.
 */
import {kv, STORAGE_KEYS} from './storage';
import {DEFAULT_SPEECH_MODEL, Emotion} from './minimaxVoice';

export interface ClonedVoice {
  /** The registered voice_id you pass to T2A. */
  voiceId: string;
  /** Display name the user can recognize. */
  label: string;
  /** Source filename that was cloned. */
  sourceName?: string;
  /** ms epoch when cloned (voices expire after 7 days if unused). */
  createdAt: number;
  /** Optional preview URL returned by the clone call. */
  demoUrl?: string;
}

export interface VoiceSettings {
  /** TTS model id, e.g. 'speech-2.6-hd'. */
  speechModel: string;
  /** Active voice_id — a system voice, or a cloned voiceId. */
  voiceId: string;
  /** Prosody. */
  speed: number;   // 0.5–2
  vol: number;     // 0–10
  pitch: number;   // -12–12
  emotion: Emotion;
  languageBoost: string;
  /** Speak assistant replies automatically while Voice Mode is on. */
  autoSpeak: boolean;
  /** Prefer the cloned voice for both TTS and voice-to-voice. */
  useClonedVoice: boolean;
  /** Registered cloned voices (most-recent first). */
  clones: ClonedVoice[];
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speechModel: DEFAULT_SPEECH_MODEL,
  voiceId: 'English_expressive_narrator',
  speed: 1,
  vol: 1,
  pitch: 0,
  emotion: 'auto',
  languageBoost: 'auto',
  autoSpeak: true,
  useClonedVoice: false,
  clones: [],
};

const MAX_CLONES = 10;

export interface VoiceStore {
  load(): Promise<VoiceSettings>;
  save(s: VoiceSettings): Promise<void>;
  patch<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]): Promise<VoiceSettings>;
  addClone(c: ClonedVoice): Promise<VoiceSettings>;
  removeClone(voiceId: string): Promise<VoiceSettings>;
}

class StoredVoiceSettings implements VoiceStore {
  async load(): Promise<VoiceSettings> {
    const raw = await kv.getItem(STORAGE_KEYS.voiceSettings);
    if (!raw) return {...DEFAULT_VOICE_SETTINGS};
    try {
      const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
      return {...DEFAULT_VOICE_SETTINGS, ...parsed, clones: parsed.clones ?? []};
    } catch {
      return {...DEFAULT_VOICE_SETTINGS};
    }
  }
  async save(s: VoiceSettings): Promise<void> {
    await kv.setItem(STORAGE_KEYS.voiceSettings, JSON.stringify(s));
  }
  async patch<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]): Promise<VoiceSettings> {
    const cur = await this.load();
    const next = {...cur, [key]: value};
    await this.save(next);
    return next;
  }
  async addClone(c: ClonedVoice): Promise<VoiceSettings> {
    const cur = await this.load();
    const clones = [c, ...cur.clones.filter(x => x.voiceId !== c.voiceId)].slice(0, MAX_CLONES);
    // Adopt the new clone as the active voice, and turn on "use cloned voice".
    const next: VoiceSettings = {...cur, clones, voiceId: c.voiceId, useClonedVoice: true};
    await this.save(next);
    return next;
  }
  async removeClone(voiceId: string): Promise<VoiceSettings> {
    const cur = await this.load();
    const clones = cur.clones.filter(x => x.voiceId !== voiceId);
    const next: VoiceSettings = {...cur, clones};
    if (cur.voiceId === voiceId) {
      next.voiceId = DEFAULT_VOICE_SETTINGS.voiceId;
      next.useClonedVoice = false;
    }
    await this.save(next);
    return next;
  }
}

export function makeVoiceStore(): VoiceStore {
  return new StoredVoiceSettings();
}
