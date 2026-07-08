/**
 * audioBridge — thin, defensive wrapper over the two native modules the Voice
 * Assistant needs:
 *
 *   - react-native-audio-recorder-player : play a TTS URL, record the mic
 *   - @react-native-voice/voice          : on-device speech-to-text (STT)
 *
 * Both are lazy-required inside try/catch (mirroring storage.ts's AsyncStorage
 * shim) so the JS bundle still loads and the app still runs if the native side
 * isn't linked yet — the UI just reports "audio unavailable, rebuild the app".
 * After `npm install` + a native rebuild these light up automatically.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

/* --------------------------- recorder / player --------------------------- */

let _player: any = null;
let _playerTried = false;

function getPlayer(): any | null {
  if (_playerTried) return _player;
  _playerTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-audio-recorder-player');
    const Exported = mod.default ?? mod;
    // v3 exports a class; some builds export a ready instance. Handle both.
    _player = typeof Exported === 'function' ? new Exported() : Exported;
  } catch {
    _player = null;
  }
  return _player;
}

export function isAudioAvailable(): boolean {
  return !!getPlayer();
}

let _playing = false;

/** Play an audio URL (or file path). Resolves when playback finishes or is
 *  stopped. Rejects only on a hard failure to start. */
export async function playUrl(url: string, onProgress?: (pos: number, dur: number) => void): Promise<void> {
  const player = getPlayer();
  if (!player) throw new Error('Audio playback unavailable — rebuild the app after installing native modules.');
  await stopPlayback().catch(() => {});
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { player.removePlayBackListener?.(); } catch {}
      _playing = false;
      resolve();
    };
    try {
      _playing = true;
      player.addPlayBackListener?.((e: any) => {
        const pos = Number(e?.currentPosition ?? e?.current_position ?? 0);
        const dur = Number(e?.duration ?? 0);
        onProgress?.(pos, dur);
        // Some versions fire isFinished; otherwise detect pos>=dur.
        if (e?.isFinished || (dur > 0 && pos >= dur)) {
          player.stopPlayer?.().catch(() => {});
          finish();
        }
      });
      const p = player.startPlayer?.(url);
      if (p && typeof p.then === 'function') {
        p.catch((err: any) => { _playing = false; reject(err); });
      }
    } catch (e) {
      _playing = false;
      reject(e);
    }
  });
}

export async function stopPlayback(): Promise<void> {
  const player = getPlayer();
  if (!player) return;
  _playing = false;
  try { await player.stopPlayer?.(); } catch {}
  try { player.removePlayBackListener?.(); } catch {}
}

export function isPlaying(): boolean {
  return _playing;
}

let _recording = false;

/** Start recording the mic. Returns the file path being written. */
export async function startRecording(): Promise<string> {
  const player = getPlayer();
  if (!player) throw new Error('Audio recording unavailable — rebuild the app after installing native modules.');
  const uri = await player.startRecorder?.();
  _recording = true;
  return typeof uri === 'string' ? uri : '';
}

/** Stop recording; returns the finished file path (or null if not recording). */
export async function stopRecording(): Promise<string | null> {
  const player = getPlayer();
  if (!player || !_recording) return null;
  _recording = false;
  try {
    const uri = await player.stopRecorder?.();
    try { player.removeRecordBackListener?.(); } catch {}
    return typeof uri === 'string' ? uri : null;
  } catch {
    return null;
  }
}

export function isRecording(): boolean {
  return _recording;
}

/* --------------------------- speech-to-text ------------------------------ */

let _voice: any = null;
let _voiceTried = false;

function getVoice(): any | null {
  if (_voiceTried) return _voice;
  _voiceTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-voice/voice');
    _voice = mod.default ?? mod;
  } catch {
    _voice = null;
  }
  return _voice;
}

export function isSttAvailable(): boolean {
  return !!getVoice();
}

export interface SttCallbacks {
  onPartial?: (text: string) => void;
  onResult?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
  locale?: string;
}

let _listening = false;

/** Begin on-device speech recognition. Wires callbacks and starts the engine.
 *  Voice-to-voice = STT here -> LLM turn -> TTS reply. */
export async function startListening(cb: SttCallbacks): Promise<void> {
  const Voice = getVoice();
  if (!Voice) throw new Error('Speech recognition unavailable — rebuild the app after installing native modules.');
  Voice.onSpeechPartialResults = (e: any) => {
    const v = e?.value?.[0];
    if (typeof v === 'string') cb.onPartial?.(v);
  };
  Voice.onSpeechResults = (e: any) => {
    const v = e?.value?.[0];
    if (typeof v === 'string') cb.onResult?.(v);
  };
  Voice.onSpeechError = (e: any) => {
    _listening = false;
    cb.onError?.(e?.error?.message ?? e?.error?.code ?? 'Speech recognition error');
  };
  Voice.onSpeechEnd = () => {
    _listening = false;
    cb.onEnd?.();
  };
  await Voice.start?.(cb.locale ?? 'en-US');
  _listening = true;
}

export async function stopListening(): Promise<void> {
  const Voice = getVoice();
  if (!Voice) return;
  _listening = false;
  try { await Voice.stop?.(); } catch {}
}

export async function cancelListening(): Promise<void> {
  const Voice = getVoice();
  if (!Voice) return;
  _listening = false;
  try { await Voice.cancel?.(); } catch {}
  try { await Voice.destroy?.(); Voice.removeAllListeners?.(); } catch {}
}

export function isListening(): boolean {
  return _listening;
}
