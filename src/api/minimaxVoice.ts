/**
 * minimaxVoice — MiniMax speech client (Text-to-Audio + Voice Cloning).
 *
 * Pure TS / framework-agnostic. Uses global `fetch` + `FormData`, so it runs
 * unchanged in React Native and in Node tests. No audio playback here — this
 * module only talks to the MiniMax REST API and returns URLs / bytes. Playback
 * and mic capture live in `audioBridge.ts`.
 *
 * Endpoints (docs: https://platform.minimax.io/docs/api-reference/api-overview):
 *   - POST {base}/t2a_v2        text -> speech (hex or url output)
 *   - POST {base}/files/upload  multipart upload (purpose=voice_clone) -> file_id
 *   - POST {base}/voice_clone   register a cloned voice_id from a file_id
 *
 * MiniMax's global platform expects the numeric GroupId as a query parameter on
 * the speech endpoints; we also send it as a header for good measure.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** TTS synthesis models. `speech-2.8-turbo` and `speech-2.6-hd` are the two the
 *  product spec calls out; the rest round out the picker. */
export interface SpeechModel {
  id: string;
  label: string;
  note: string;
  /** HD = higher quality / higher latency; turbo = faster / real-time. */
  tier: 'hd' | 'turbo';
}

export const SPEECH_MODELS: SpeechModel[] = [
  {id: 'speech-2.8-turbo', label: 'Speech 2.8 Turbo', note: 'Latest Turbo model. Seamless speed meets natural flow.', tier: 'turbo'},
  {id: 'speech-2.6-hd',    label: 'Speech 2.6 HD',    note: 'HD model with real-time response, intelligent parsing, fluent LoRA voice.', tier: 'hd'},
  {id: 'speech-2.8-hd',    label: 'Speech 2.8 HD',    note: 'Latest HD model. Ultra-realistic quality featuring sound tags.', tier: 'hd'},
  {id: 'speech-2.6-turbo', label: 'Speech 2.6 Turbo', note: 'Turbo model with support for 40 languages.', tier: 'turbo'},
  {id: 'speech-02-hd',     label: 'Speech 02 HD',     note: 'Superior rhythm and stability, strong cloning similarity.', tier: 'hd'},
  {id: 'speech-02-turbo',  label: 'Speech 02 Turbo',  note: 'Superior rhythm and stability, enhanced multilingual.', tier: 'turbo'},
];

export const DEFAULT_SPEECH_MODEL = 'speech-2.6-hd';

/** A curated slice of the MiniMax system-voice catalog (full list via the Get
 *  Voice API / faq/system-voice-id). Enough to pick from without a fetch. */
export interface SystemVoice {
  id: string;
  label: string;
  lang: string;
}

export const SYSTEM_VOICES: SystemVoice[] = [
  {id: 'English_expressive_narrator', label: 'Expressive Narrator', lang: 'English'},
  {id: 'English_Graceful_Lady',       label: 'Graceful Lady',       lang: 'English'},
  {id: 'English_Insightful_Speaker',  label: 'Insightful Speaker',  lang: 'English'},
  {id: 'English_radiant_girl',        label: 'Radiant Girl',        lang: 'English'},
  {id: 'English_Persuasive_Man',      label: 'Persuasive Man',      lang: 'English'},
  {id: 'English_Lucky_Robot',         label: 'Lucky Robot',         lang: 'English'},
  {id: 'Chinese (Mandarin)_Lyrical_Voice',        label: 'Lyrical Voice (Mandarin)', lang: 'Chinese'},
  {id: 'Chinese (Mandarin)_HK_Flight_Attendant',  label: 'Flight Attendant (Mandarin)', lang: 'Chinese'},
  {id: 'Cantonese_GentleLady',        label: 'Gentle Lady (Cantonese)', lang: 'Chinese,Yue'},
  {id: 'Japanese_Whisper_Belle',      label: 'Whisper Belle (Japanese)', lang: 'Japanese'},
];

export const EMOTIONS = ['auto', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'whisper'] as const;
export type Emotion = typeof EMOTIONS[number];

export interface MinimaxCreds {
  /** Bearer API key. */
  apiKey: string;
  /** Base URL incl. /v1, e.g. https://api.minimax.io/v1 */
  baseUrl: string;
  /** Numeric GroupId — required by the speech endpoints on the global platform. */
  groupId?: string;
}

/** True when a chat model id belongs to MiniMax (gates the voice UI). */
export function isMinimaxModelId(id?: string | null): boolean {
  if (!id) return false;
  const l = id.toLowerCase();
  return (
    l.startsWith('minimax') ||
    l.startsWith('abab') ||
    l.startsWith('speech-') ||
    l.includes('minimax')
  );
}

/* -------------------------------------------------------------------------- */
/* internals                                                                  */
/* -------------------------------------------------------------------------- */

function trimBase(base: string): string {
  return (base || 'https://api.minimax.io/v1').replace(/\/+$/, '');
}

/** Append ?GroupId=… (speech endpoints want it on the query string). */
function withGroup(url: string, groupId?: string): string {
  const g = groupId?.trim();
  if (!g) return url;
  return url + (url.includes('?') ? '&' : '?') + 'GroupId=' + encodeURIComponent(g);
}

function authHeaders(creds: MinimaxCreds, json = true): Record<string, string> {
  const h: Record<string, string> = {Authorization: `Bearer ${creds.apiKey}`};
  if (json) h['Content-Type'] = 'application/json';
  if (creds.groupId?.trim()) h.GroupId = creds.groupId.trim();
  return h;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** hex string -> base64 (no Buffer/btoa dependency, works in RN). Used to build
 *  a data: URI for the aggregated audio when the API returns hex. */
export function hexToBase64(hex: string): string {
  if (!hex) return '';
  const clean = hex.trim();
  let out = '';
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const byte = parseInt(clean.substr(i, 2), 16);
    if (Number.isNaN(byte)) continue;
    acc = (acc << 8) | byte;
    accBits += 8;
    while (accBits >= 6) {
      accBits -= 6;
      out += B64[(acc >> accBits) & 0x3f];
    }
  }
  if (accBits > 0) {
    out += B64[(acc << (6 - accBits)) & 0x3f];
  }
  while (out.length % 4) out += '=';
  return out;
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pcm: 'audio/L16',
};

export function audioDataUri(hex: string, format = 'mp3'): string {
  return `data:${AUDIO_MIME[format] ?? 'audio/mpeg'};base64,${hexToBase64(hex)}`;
}

export type VoiceResult<T> = ({ok: true} & T) | {ok: false; error: string; code?: number};

/* -------------------------------------------------------------------------- */
/* Text -> Speech                                                             */
/* -------------------------------------------------------------------------- */

export interface T2AParams {
  text: string;
  model: string;
  voiceId: string;
  speed?: number;       // 0.5 – 2
  vol?: number;         // 0 – 10
  pitch?: number;       // -12 – 12
  emotion?: Emotion;    // 'auto' means: omit and let the model decide
  languageBoost?: string;
  format?: 'mp3' | 'wav' | 'flac' | 'pcm';
  sampleRate?: number;
  bitrate?: number;
  timeoutMs?: number;
}

function buildT2ABody(p: T2AParams, stream: boolean, outputFormat: 'url' | 'hex') {
  const voice_setting: any = {
    voice_id: p.voiceId,
    speed: p.speed ?? 1,
    vol: p.vol ?? 1,
    pitch: p.pitch ?? 0,
  };
  if (p.emotion && p.emotion !== 'auto') voice_setting.emotion = p.emotion;
  return {
    model: p.model,
    text: p.text,
    stream,
    output_format: outputFormat,
    language_boost: p.languageBoost ?? 'auto',
    voice_setting,
    audio_setting: {
      sample_rate: p.sampleRate ?? 32000,
      bitrate: p.bitrate ?? 128000,
      format: p.format ?? 'mp3',
      channel: 1,
    },
  };
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  return `HTTP ${res.status}: ${body.slice(0, 240)}`;
}

/** Synthesize speech and return a playable URL (valid ~24h). Non-streaming.
 *  This is the path the app plays through the native player. */
export async function t2aUrl(creds: MinimaxCreds, p: T2AParams): Promise<VoiceResult<{url: string; format: string}>> {
  if (!creds.apiKey) return {ok: false, error: 'MiniMax API key not set.'};
  if (!p.text.trim()) return {ok: false, error: 'Nothing to speak.'};
  const url = withGroup(`${trimBase(creds.baseUrl)}/t2a_v2`, creds.groupId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), p.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(creds),
      signal: ctrl.signal,
      body: JSON.stringify(buildT2ABody(p, false, 'url')),
    });
    if (!res.ok) return {ok: false, error: await readError(res), code: res.status};
    const j: any = await res.json();
    const code = j?.base_resp?.status_code;
    if (code && code !== 0) {
      return {ok: false, error: `MiniMax ${code}: ${j?.base_resp?.status_msg ?? 'error'}`, code};
    }
    const audio = j?.data?.audio;
    if (!audio || typeof audio !== 'string') {
      return {ok: false, error: 'No audio URL returned by MiniMax.'};
    }
    return {ok: true, url: audio, format: j?.extra_info?.audio_format ?? (p.format ?? 'mp3')};
  } catch (e: any) {
    return {ok: false, error: e?.name === 'AbortError' ? 'TTS request timed out.' : (e?.message ?? String(e))};
  } finally {
    clearTimeout(timer);
  }
}

/** Synthesize speech and return the aggregated audio as hex + a data: URI.
 *  Fallback when a caller prefers embedding audio over a hosted URL. */
export async function t2aHex(creds: MinimaxCreds, p: T2AParams): Promise<VoiceResult<{hex: string; dataUri: string; format: string}>> {
  if (!creds.apiKey) return {ok: false, error: 'MiniMax API key not set.'};
  if (!p.text.trim()) return {ok: false, error: 'Nothing to speak.'};
  const url = withGroup(`${trimBase(creds.baseUrl)}/t2a_v2`, creds.groupId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), p.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(creds),
      signal: ctrl.signal,
      body: JSON.stringify(buildT2ABody(p, false, 'hex')),
    });
    if (!res.ok) return {ok: false, error: await readError(res), code: res.status};
    const j: any = await res.json();
    const code = j?.base_resp?.status_code;
    if (code && code !== 0) {
      return {ok: false, error: `MiniMax ${code}: ${j?.base_resp?.status_msg ?? 'error'}`, code};
    }
    const hex = j?.data?.audio;
    if (!hex || typeof hex !== 'string') return {ok: false, error: 'No audio returned by MiniMax.'};
    const format = j?.extra_info?.audio_format ?? (p.format ?? 'mp3');
    return {ok: true, hex, dataUri: audioDataUri(hex, format), format};
  } catch (e: any) {
    return {ok: false, error: e?.name === 'AbortError' ? 'TTS request timed out.' : (e?.message ?? String(e))};
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Voice cloning                                                              */
/* -------------------------------------------------------------------------- */

/** Generate a MiniMax-valid custom voice_id: starts with a letter, 8–256 chars,
 *  letters/digits/-/_, never ends with -/_. */
export function makeCloneVoiceId(prefix = 'HermesVoice'): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let id = `${prefix}${stamp}`.replace(/[^A-Za-z0-9_-]/g, '');
  if (!/^[A-Za-z]/.test(id)) id = 'V' + id;
  id = id.replace(/[-_]+$/, '');
  if (id.length < 8) id = (id + 'Clone00000000').slice(0, 12);
  return id.slice(0, 256);
}

export interface CloneFile {
  /** file:// URI on device (from the document/image picker). */
  uri: string;
  name: string;
  mime?: string;
}

/** MiniMax voice cloning accepts mp3 / m4a / wav. An .mp4 is an MPEG-4
 *  container — if it is audio-only (or its audio track is usable) MiniMax can
 *  ingest it when presented as m4a. We normalize the upload filename/mime so a
 *  user-picked .mp4 has the best chance of being accepted; if the container has
 *  video the API may still reject it, which we surface verbatim. */
function normalizeForClone(file: CloneFile): {name: string; mime: string} {
  const lower = (file.name || '').toLowerCase();
  const mime = (file.mime || '').toLowerCase();
  const isMp4Container = lower.endsWith('.mp4') || lower.endsWith('.mov') || mime.includes('mp4') || mime.startsWith('video/');
  if (isMp4Container) {
    const stem = file.name.replace(/\.[^.]+$/, '') || 'clip';
    return {name: `${stem}.m4a`, mime: 'audio/m4a'};
  }
  const guessed =
    lower.endsWith('.wav') ? 'audio/wav' :
    lower.endsWith('.m4a') ? 'audio/m4a' :
    lower.endsWith('.flac') ? 'audio/flac' :
    'audio/mpeg';
  return {name: file.name || 'clip.mp3', mime: file.mime || guessed};
}

/** Upload an audio (or mp4) file for cloning. Returns the numeric file_id. */
export async function uploadCloneFile(
  creds: MinimaxCreds,
  file: CloneFile,
  purpose: 'voice_clone' | 'prompt_audio' = 'voice_clone',
): Promise<VoiceResult<{fileId: number}>> {
  if (!creds.apiKey) return {ok: false, error: 'MiniMax API key not set.'};
  const {name, mime} = normalizeForClone(file);
  const url = withGroup(`${trimBase(creds.baseUrl)}/files/upload`, creds.groupId);
  const form = new FormData();
  form.append('purpose', purpose);
  // RN FormData accepts {uri, name, type}; browsers/Node need a Blob, but this
  // module runs on-device so the RN shape is correct.
  form.append('file', {uri: file.uri, name, type: mime} as any);
  try {
    const headers: Record<string, string> = {Authorization: `Bearer ${creds.apiKey}`};
    if (creds.groupId?.trim()) headers.GroupId = creds.groupId.trim();
    // NB: do NOT set Content-Type — fetch adds the multipart boundary itself.
    const res = await fetch(url, {method: 'POST', headers, body: form as any});
    if (!res.ok) return {ok: false, error: await readError(res), code: res.status};
    const j: any = await res.json();
    const code = j?.base_resp?.status_code;
    if (code && code !== 0) {
      return {ok: false, error: `MiniMax ${code}: ${j?.base_resp?.status_msg ?? 'upload error'}`, code};
    }
    const fileId = j?.file?.file_id;
    if (typeof fileId !== 'number') return {ok: false, error: 'Upload succeeded but no file_id was returned.'};
    return {ok: true, fileId};
  } catch (e: any) {
    return {ok: false, error: e?.message ?? String(e)};
  }
}

export interface CloneParams {
  fileId: number;
  voiceId?: string;
  /** Optional preview text; if set, `model` is required and MiniMax bills a
   *  preview synthesis and returns demoAudio. */
  previewText?: string;
  model?: string;
  languageBoost?: string;
  needNoiseReduction?: boolean;
  needVolumeNormalization?: boolean;
}

/** Register a cloned voice from an uploaded file. Returns the voice_id you then
 *  pass to t2aUrl/t2aHex. The voice is temporary — synthesize with it within 7
 *  days to keep it. */
export async function cloneVoice(creds: MinimaxCreds, p: CloneParams): Promise<VoiceResult<{voiceId: string; demoUrl?: string}>> {
  if (!creds.apiKey) return {ok: false, error: 'MiniMax API key not set.'};
  const voiceId = (p.voiceId && p.voiceId.trim()) || makeCloneVoiceId();
  const url = withGroup(`${trimBase(creds.baseUrl)}/voice_clone`, creds.groupId);
  const body: any = {
    file_id: p.fileId,
    voice_id: voiceId,
    need_noise_reduction: p.needNoiseReduction ?? false,
    need_volume_normalization: p.needVolumeNormalization ?? false,
  };
  if (p.previewText && p.previewText.trim()) {
    body.text = p.previewText.trim().slice(0, 1000);
    body.model = p.model || DEFAULT_SPEECH_MODEL;
  }
  if (p.languageBoost) body.language_boost = p.languageBoost;
  try {
    const res = await fetch(url, {method: 'POST', headers: authHeaders(creds), body: JSON.stringify(body)});
    if (!res.ok) return {ok: false, error: await readError(res), code: res.status};
    const j: any = await res.json();
    const code = j?.base_resp?.status_code;
    if (code && code !== 0) {
      return {ok: false, error: `MiniMax ${code}: ${j?.base_resp?.status_msg ?? 'clone error'}`, code};
    }
    return {ok: true, voiceId, demoUrl: j?.demo_audio || undefined};
  } catch (e: any) {
    return {ok: false, error: e?.message ?? String(e)};
  }
}


/* -------------------------------------------------------------------------- */
/* Voice catalog — list EVERY available voice                                 */
/* -------------------------------------------------------------------------- */

export interface VoiceInfo {
  voiceId: string;
  name: string;
  description?: string;
  category: 'system' | 'cloned' | 'generated';
  lang?: string;
}

/** Best-effort language from a system voice_id prefix, e.g.
 *  "English_...", "Chinese (Mandarin)_...", "Japanese_...". */
function guessVoiceLang(voiceId: string): string | undefined {
  const m = /^([A-Za-z][A-Za-z ()]*?)_/.exec(voiceId);
  return m ? m[1].trim() : undefined;
}

/** List ALL voices available to the account in one call: system voices (300+),
 *  cloned voices, and generated (voice-design) voices. MiniMax's get_voice
 *  returns the complete set for the requested voice_type (no pagination). */
export async function listVoices(
  creds: MinimaxCreds,
  voiceType: 'all' | 'system' | 'voice_cloning' | 'voice_generation' = 'all',
): Promise<VoiceResult<{voices: VoiceInfo[]}>> {
  if (!creds.apiKey) return {ok: false, error: 'MiniMax API key not set.'};
  const url = withGroup(`${trimBase(creds.baseUrl)}/get_voice`, creds.groupId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(creds),
      signal: ctrl.signal,
      body: JSON.stringify({voice_type: voiceType}),
    });
    if (!res.ok) return {ok: false, error: await readError(res), code: res.status};
    const j: any = await res.json();
    const code = j?.base_resp?.status_code;
    if (code && code !== 0) {
      return {ok: false, error: `MiniMax ${code}: ${j?.base_resp?.status_msg ?? 'get_voice error'}`, code};
    }
    const voices: VoiceInfo[] = [];
    const seen = new Set<string>();
    const take = (arr: any, category: VoiceInfo['category']) => {
      if (!Array.isArray(arr)) return;
      for (const v of arr) {
        const id = v?.voice_id;
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        seen.add(id);
        const desc = Array.isArray(v?.description)
          ? v.description.filter(Boolean).join(' ')
          : (typeof v?.description === 'string' ? v.description : undefined);
        voices.push({
          voiceId: id,
          name: (typeof v?.voice_name === 'string' && v.voice_name) || id,
          description: desc || undefined,
          category,
          lang: category === 'system' ? guessVoiceLang(id) : undefined,
        });
      }
    };
    take(j?.system_voice, 'system');
    take(j?.voice_cloning, 'cloned');
    take(j?.voice_generation, 'generated');
    return {ok: true, voices};
  } catch (e: any) {
    return {ok: false, error: e?.name === 'AbortError' ? 'Voice list request timed out.' : (e?.message ?? String(e))};
  } finally {
    clearTimeout(timer);
  }
}
