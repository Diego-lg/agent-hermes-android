/**
 * SpeechToSpeechOverlay — full-screen, hands-free voice conversation UI.
 *
 * Drives a simple phase machine around the shared voice hook:
 *   listening → (final transcript) → thinking (LLM streaming)
 *            → speaking (TTS) → listening …
 *
 * The immersive UI is anchored by <AssistantOrb>, a fluid water-drop sphere
 * whose motion tracks the current phase so the user can see the assistant is
 * hearing / thinking / talking.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal, View, Text, TouchableOpacity, Platform} from 'react-native';
import {useTheme} from './theme.tsx';
import {XIcon, MicIcon, StopIcon, Volume2Icon} from './icons';
import AssistantOrb, {OrbPhase} from './AssistantOrb';

type VoiceApi = {
  ready: boolean;
  audioAvailable: boolean;
  speaking: boolean;
  listening: boolean;
  micLevel: number;
  transcript: string;
  settings: {useClonedVoice?: boolean; speechModel?: string};
  speak: (t: string) => Promise<void> | void;
  stopSpeaking: () => Promise<void> | void;
  startListening: (opts?: {onFinal?: (t: string) => void}) => Promise<void> | void;
  stopListening: () => Promise<void> | void;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  voice: VoiceApi;
  sendPrompt: (text: string) => void | Promise<any>;
  messages: {role: string; text: string}[];
  streaming: boolean;
  accent: string;
}

const PHASE_LABEL: Record<OrbPhase, string> = {
  idle: 'TAP TO START',
  listening: 'LISTENING…',
  thinking: 'THINKING…',
  speaking: 'SPEAKING…',
};

export default function SpeechToSpeechOverlay({
  visible, onClose, voice, sendPrompt, messages, streaming, accent,
}: Props) {
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});

  const [phase, setPhase] = useState<OrbPhase>('idle');
  const [paused, setPaused] = useState(false);

  // Refs so async callbacks always read the latest values.
  const visibleRef = useRef(visible);
  const pausedRef = useRef(paused);
  const messagesRef = useRef(messages);
  const spokenRef = useRef(messages.length);
  const prevSpeaking = useRef(false);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const beginListen = useCallback(async () => {
    if (!voice.audioAvailable) { setPhase('idle'); return; }
    setPhase('listening');
    await voice.startListening({
      onFinal: (tx) => {
        const clean = (tx || '').trim();
        if (!visibleRef.current || pausedRef.current) return;
        if (!clean) {
          // Heard nothing — gently loop back to listening.
          setTimeout(() => { if (visibleRef.current && !pausedRef.current) void beginListen(); }, 350);
          return;
        }
        spokenRef.current = messagesRef.current.length; // baseline before reply
        setPhase('thinking');
        void sendPrompt(clean);
      },
    });
  }, [voice, sendPrompt]);

  // Enter / leave the overlay.
  useEffect(() => {
    if (visible) {
      setPaused(false);
      spokenRef.current = messagesRef.current.length;
      if (voice.audioAvailable && voice.ready) {
        void beginListen();
      } else {
        setPhase('idle');
      }
    } else {
      void voice.stopListening();
      void voice.stopSpeaking();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // When a fresh assistant reply finishes streaming, speak it.
  useEffect(() => {
    if (!visible || paused || streaming) return;
    if (messages.length <= spokenRef.current) return;
    const last = messages[messages.length - 1];
    spokenRef.current = messages.length;
    if (last && last.role === 'assistant' && last.text && last.text.trim()) {
      if (voice.audioAvailable) {
        setPhase('speaking');
        void voice.speak(last.text);
      } else {
        // No audio module — just resume listening.
        void beginListen();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming, visible, paused]);

  // When speaking ends, loop back to listening.
  useEffect(() => {
    if (prevSpeaking.current && !voice.speaking) {
      if (visibleRef.current && !pausedRef.current) void beginListen();
      else setPhase('idle');
    }
    prevSpeaking.current = voice.speaking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.speaking]);

  const onTogglePause = useCallback(() => {
    setPaused(prev => {
      const next = !prev;
      if (next) {
        void voice.stopListening();
        void voice.stopSpeaking();
        setPhase('idle');
      } else {
        void beginListen();
      }
      return next;
    });
  }, [voice, beginListen]);

  const onTapOrb = useCallback(() => {
    if (phase === 'idle' && !paused) void beginListen();
  }, [phase, paused, beginListen]);

  // Real mic amplitude drives the orb while listening; TTS uses a lively fixed level.
  const level = phase === 'listening'
    ? Math.min(1, voice.micLevel * 1.3)
    : phase === 'speaking' ? 0.55 : 0;
  const voiceLabel = voice.settings.useClonedVoice ? 'CLONED VOICE' : (voice.settings.speechModel || 'minimax');

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: palette.bg}}>
        {/* Top bar */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: spacing.lg, paddingTop: 48, paddingBottom: 12,
        }}>
          <Volume2Icon size={14} color={accent} />
          <Text style={[type.mono, {color: accent, fontSize: 11, marginLeft: 8, flex: 1, letterSpacing: 1, fontFamily: monoFont}]}>
            SPEECH TO SPEECH
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{top:10,bottom:10,left:10,right:10}} style={{padding: 6}}>
            <XIcon size={20} color={palette.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Orb */}
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <TouchableOpacity activeOpacity={0.9} onPress={onTapOrb}>
            <AssistantOrb phase={paused ? 'idle' : phase} level={level} color={accent} size={300} />
          </TouchableOpacity>

          <Text style={[type.mono, {
            color: paused ? palette.textDim : accent,
            fontSize: 13, letterSpacing: 2, marginTop: 8, fontFamily: monoFont,
          }]}>
            {paused ? 'PAUSED' : PHASE_LABEL[phase]}
          </Text>

          {/* Live transcript while listening */}
          {!paused && phase === 'listening' && voice.transcript ? (
            <Text style={[type.body, {
              color: palette.textMuted, fontSize: 14, marginTop: 14,
              paddingHorizontal: 32, textAlign: 'center', maxWidth: 420,
            }]} numberOfLines={3}>
              {voice.transcript}
            </Text>
          ) : null}

          {!voice.audioAvailable ? (
            <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 18, paddingHorizontal: 32, textAlign: 'center', fontFamily: monoFont}]}>
              audio module not linked yet — rebuild the app (npm run build:apk) to enable the microphone and playback
            </Text>
          ) : null}
        </View>

        {/* Bottom controls */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          gap: 20, paddingBottom: 48, paddingTop: 12,
        }}>
          <Text style={[type.monoMuted, {position: 'absolute', left: spacing.lg, bottom: 52, color: palette.textGhost, fontSize: 9, fontFamily: monoFont}]}>
            {voiceLabel}
          </Text>
          <TouchableOpacity
            onPress={onTogglePause}
            disabled={!voice.audioAvailable}
            style={{
              width: 64, height: 64, borderRadius: 32,
              borderWidth: 1.5,
              borderColor: paused ? accent : palette.border,
              backgroundColor: paused ? (palette.accentMuted ?? palette.surfaceAlt) : palette.surface,
              alignItems: 'center', justifyContent: 'center',
              opacity: voice.audioAvailable ? 1 : 0.4,
            }}>
            {paused
              ? <MicIcon size={24} color={accent} />
              : <StopIcon size={20} color={palette.error} filled />}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
