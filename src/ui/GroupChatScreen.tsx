/**
 * GroupChatScreen — set up a multi-agent discussion (presets, roster, mode,
 * voice) then watch it unfold. The user is a first-class participant: type to
 * interject, @mention to force one agent, or continue the discussion by rounds.
 *
 * Orchestration lives in api/groupChat (engine-agnostic); this screen wires it
 * to the live backend via useGroupRunner, mirrors the transcript into React
 * state for rendering, and speaks each finished turn through a serial queue so
 * voices never overlap.
 */
import React, {useEffect, useMemo, useRef, useState, useCallback} from 'react';
import {View, ScrollView, TouchableOpacity, Text, TextInput, Platform} from 'react-native';
import {useTheme} from './theme.tsx';
import {Button} from './atoms';
import {
  UsersIcon, AtSignIcon, XIcon, PlayIcon, Volume2Icon, PlusIcon, ChevronRightIcon,
} from './icons';
import {
  makePersonalityStore, makeGroupStore, Personality, GroupMode, GroupConfig,
  DEFAULT_PARTICIPANT_CAP, MAX_PARTICIPANTS, defaultGroupConfig,
} from '../api/personalityStore';
import {GroupChat, GroupParticipant, TranscriptEntry} from '../api/groupChat';
import {GROUP_PRESETS} from './groupPresets';
import {useGroupRunner, PersonaVoice} from './groupRunner';
import {PersonaBadge} from './PersonalityLibraryScreen';
import MarkdownText from './MarkdownText';

const monoFont = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});

export default function GroupChatScreen() {
  const {palette, spacing, type} = useTheme();
  const runner = useGroupRunner();

  const store = useMemo(() => makePersonalityStore(), []);
  const groupStore = useMemo(() => makeGroupStore(), []);

  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [savedGroups, setSavedGroups] = useState<GroupConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<GroupMode>('round_robin');
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  const [started, setStarted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [liveText, setLiveText] = useState('');
  const [running, setRunning] = useState(false);
  const [muteThisRound, setMuteThisRound] = useState(false);
  const [composer, setComposer] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setPersonalities(await store.load());
      try { setSavedGroups(await groupStore.load()); } catch { /* none yet */ }
    })();
  }, [store, groupStore]);

  const byId = useMemo(() => {
    const m: Record<string, Personality> = {};
    personalities.forEach(p => { m[p.id] = p; });
    return m;
  }, [personalities]);

  // Refs so orchestrator callbacks (created once per run) read the latest state.
  const gcRef = useRef<GroupChat | null>(null);
  const voiceOnRef = useRef(false);
  const muteRef = useRef(false);
  const stoppedRef = useRef(false);
  const byIdRef = useRef(byId);
  useEffect(() => { byIdRef.current = byId; }, [byId]);
  useEffect(() => { voiceOnRef.current = voiceEnabled; }, [voiceEnabled]);
  useEffect(() => { muteRef.current = muteThisRound; }, [muteThisRound]);

  // Serial speech queue — playback never overlaps because each item awaits the
  // previous (playUrl resolves on completion).
  const speechQ = useRef<Array<{text: string; voice: PersonaVoice}>>([]);
  const draining = useRef(false);
  const drainSpeech = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (speechQ.current.length && !stoppedRef.current) {
        const item = speechQ.current.shift()!;
        await runner.speakAs(item.text, item.voice);
      }
    } finally {
      draining.current = false;
    }
  }, [runner]);

  const scrollRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({animated: true}), 60);
    return () => clearTimeout(t);
  }, [transcript, liveText]);

  const participants = useMemo<GroupParticipant[]>(
    () => selectedIds.flatMap(id => {
      const p = byId[id];
      return p ? [{id: p.id, name: p.name, systemPrompt: p.systemPrompt, modelId: p.modelId}] : [];
    }),
    [selectedIds, byId],
  );

  const buildOrchestrator = useCallback((): GroupChat => {
    return new GroupChat({
      participants,
      mode,
      runTurn: runner.runTurn,
      callbacks: {
        onSpeakerStart: p => { setSpeakingId(p.id); setLiveText(''); },
        onDelta: chunk => setLiveText(prev => prev + chunk),
        onSpeakerDone: (p, text) => {
          setTranscript(prev => [...prev, {speaker: p.name, participantId: p.id, text, ts: Date.now()}]);
          setLiveText('');
          setSpeakingId(null);
          if (voiceOnRef.current && !muteRef.current) {
            const src = byIdRef.current[p.id];
            if (src) {
              speechQ.current.push({
                text,
                voice: {voiceId: src.voiceId, speechModel: src.speechModel, speed: src.speed, emotion: src.emotion},
              });
              void drainSpeech();
            }
          }
        },
        onError: err => setError(err.message),
      },
    });
  }, [participants, mode, runner, drainSpeech]);

  const matchMention = useCallback((text: string): string | null => {
    const lower = text.toLowerCase();
    if (!lower.includes('@')) return null;
    for (const p of participants) {
      const first = p.name.split(/\s+/)[0].toLowerCase();
      if (lower.includes('@' + first) || lower.includes('@' + p.id.toLowerCase())) return p.id;
    }
    return null;
  }, [participants]);

  const start = useCallback(async () => {
    if (!participants.length || !runner.hasBackend) return;
    stoppedRef.current = false;
    const gc = buildOrchestrator();
    gcRef.current = gc;
    setStarted(true);
    setError(null);
    setTranscript([]);
    // Remember this roster for next time (best-effort).
    void groupStore.add({...defaultGroupConfig(selectedIds, 'Recent group'), mode, voiceEnabled}).catch(() => {});
    const seed = composer.trim();
    setComposer('');
    if (seed) { gc.addUserMessage(seed); setTranscript(gc.getTranscript()); }
    setRunning(true);
    await gc.run(1);
    setRunning(false);
    setMuteThisRound(false);
  }, [participants, runner, buildOrchestrator, groupStore, selectedIds, mode, voiceEnabled, composer]);

  const continueRounds = useCallback(async (n: number) => {
    const gc = gcRef.current;
    if (!gc || running) return;
    stoppedRef.current = false;
    setRunning(true);
    await gc.run(n);
    setRunning(false);
    setMuteThisRound(false);
  }, [running]);

  const send = useCallback(async () => {
    const text = composer.trim();
    const gc = gcRef.current;
    if (!text || !gc || running) return;
    setComposer('');
    gc.addUserMessage(text);
    setTranscript(gc.getTranscript());
    const mention = matchMention(text);
    stoppedRef.current = false;
    setRunning(true);
    if (mention) await gc.speak(mention);
    else await gc.run(1);
    setRunning(false);
    setMuteThisRound(false);
  }, [composer, running, matchMention]);

  const stop = useCallback(() => {
    gcRef.current?.abort();
    stoppedRef.current = true;
    speechQ.current = [];
    void runner.stopSpeaking();
    setRunning(false);
    setSpeakingId(null);
    setLiveText('');
  }, [runner]);

  const resetToBuilder = useCallback(() => {
    stop();
    gcRef.current = null;
    setStarted(false);
    setTranscript([]);
    setError(null);
  }, [stop]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length >= MAX_PARTICIPANTS ? prev : [...prev, id]);
  };
  const applyPreset = (ids: string[], m: GroupMode) => {
    setSelectedIds(ids.filter(id => byId[id]));
    setMode(m);
  };

  /* ----------------------------- Builder view ----------------------------- */
  const renderBuilder = () => (
    <ScrollView style={{flex: 1, backgroundColor: palette.bg}} contentContainerStyle={{paddingBottom: 56}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <Text style={type.label}>GROUP</Text>
        <Text style={[type.displaySmall, {marginTop: spacing.sm}]}>Group Chat</Text>
        <Text style={[type.body, {color: palette.textMuted, marginTop: 6, fontSize: 12, maxWidth: 300}]}>
          Put several personalities in one room and let them discuss, debate, or brainstorm — with you in the loop.
        </Text>

        {!runner.hasBackend ? (
          <View style={{marginTop: spacing.lg, padding: spacing.md, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt}}>
            <Text style={[type.body, {color: palette.textMuted, fontSize: 12}]}>
              No backend yet. Connect the desktop server or add a MiniMax API key in Settings → AI to run a discussion.
            </Text>
          </View>
        ) : null}

        {/* Presets */}
        <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.xl, marginBottom: 8}]}>START FROM A PRESET</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 10, paddingRight: spacing.lg}}>
          {GROUP_PRESETS.map(pr => (
            <TouchableOpacity
              key={pr.id}
              activeOpacity={0.75}
              onPress={() => applyPreset(pr.participantIds, pr.mode)}
              style={{
                width: 170, padding: spacing.md, borderRadius: 12,
                borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface,
              }}>
              <PersonaBadge icon={pr.icon} color={pr.color} badge={34} size={17} />
              <Text style={[type.h2, {fontSize: 13, marginTop: 8}]}>{pr.name}</Text>
              <Text style={[type.body, {color: palette.textMuted, fontSize: 11, marginTop: 3}]} numberOfLines={3}>{pr.blurb}</Text>
              <Text style={[type.mono, {color: palette.textDim, fontSize: 9, marginTop: 6, fontFamily: monoFont}]}>
                {pr.participantIds.length} · {pr.mode === 'moderated' ? 'MODERATED' : 'ROUND-ROBIN'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Saved groups */}
        {savedGroups.length > 0 ? (
          <>
            <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.lg, marginBottom: 8}]}>RECENT</Text>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
              {savedGroups.slice(0, 6).map(g => (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => { setSelectedIds(g.participantIds.filter(id => byId[id])); setMode(g.mode); setVoiceEnabled(g.voiceEnabled); }}
                  style={{paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: palette.border}}>
                  <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                    {g.participantIds.length} · {g.mode === 'moderated' ? 'MOD' : 'RR'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}

        {/* Participants */}
        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: 8}}>
          <Text style={[type.label, {color: palette.textMuted, flex: 1}]}>
            PARTICIPANTS · {selectedIds.length}/{MAX_PARTICIPANTS}
          </Text>
          {selectedIds.length > DEFAULT_PARTICIPANT_CAP ? (
            <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>
              {selectedIds.length} can get chatty
            </Text>
          ) : null}
        </View>
        {personalities.map(p => {
          const selected = selectedIds.includes(p.id);
          const order = selectedIds.indexOf(p.id);
          return (
            <TouchableOpacity
              key={p.id}
              activeOpacity={0.6}
              onPress={() => toggleSelect(p.id)}
              style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 10}}>
              <PersonaBadge icon={p.icon} color={p.color} badge={34} size={17} />
              <View style={{flex: 1, marginLeft: spacing.md}}>
                <Text style={[type.h2, {fontSize: 13}]}>{p.name}</Text>
                <Text style={[type.body, {color: palette.textMuted, fontSize: 11, marginTop: 1}]} numberOfLines={1}>{p.blurb}</Text>
              </View>
              <View style={{
                width: 24, height: 24, borderRadius: 12,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: selected ? 0 : 1.5, borderColor: palette.border,
                backgroundColor: selected ? p.color : 'transparent',
              }}>
                {selected ? (
                  <Text style={{color: '#fff', fontSize: 11, fontWeight: '700'}}>{order + 1}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Mode */}
        <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.lg, marginBottom: 8}]}>MODE</Text>
        <View style={{flexDirection: 'row', gap: 10}}>
          {(['round_robin', 'moderated'] as GroupMode[]).map(m => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
                  borderWidth: 1, borderColor: active ? palette.accent : palette.border,
                  backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                }}>
                <Text style={[type.body, {color: active ? palette.accent : palette.text, fontSize: 13, fontWeight: '600'}]}>
                  {m === 'round_robin' ? 'Round-robin' : 'Moderated'}
                </Text>
                <Text style={[type.mono, {color: palette.textDim, fontSize: 9, marginTop: 2, fontFamily: monoFont}]}>
                  {m === 'round_robin' ? 'everyone, in order' : 'a director picks'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Voice */}
        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg}}>
          <Volume2Icon size={16} color={palette.accent} />
          <View style={{flex: 1, marginLeft: 10}}>
            <Text style={[type.body, {fontSize: 13}]}>Speak responses aloud</Text>
            <Text style={[type.body, {color: palette.textDim, fontSize: 11}]}>
              {!runner.voiceReady
                ? 'Add a MiniMax key to enable voices'
                : !runner.audioAvailable
                  ? 'Rebuild the app to enable audio playback'
                  : 'Each personality uses its own MiniMax voice'}
            </Text>
          </View>
          <TouchableOpacity
            disabled={!runner.voiceReady || !runner.audioAvailable}
            onPress={() => setVoiceEnabled(v => !v)}
            style={{
              width: 52, height: 30, borderRadius: 15, padding: 3,
              backgroundColor: voiceEnabled ? palette.accent : palette.surfaceAlt,
              borderWidth: 1, borderColor: palette.border,
              opacity: (!runner.voiceReady || !runner.audioAvailable) ? 0.4 : 1,
              alignItems: voiceEnabled ? 'flex-end' : 'flex-start',
            }}>
            <View style={{width: 22, height: 22, borderRadius: 11, backgroundColor: voiceEnabled ? '#fff' : palette.textDim}} />
          </TouchableOpacity>
        </View>

        {/* Topic + start */}
        <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.lg, marginBottom: 6}]}>TOPIC (OPTIONAL)</Text>
        <TextInput
          value={composer}
          onChangeText={setComposer}
          placeholder="What should they discuss? Leave blank to let them open."
          placeholderTextColor={palette.textDim}
          multiline
          style={{
            backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: 10,
            borderWidth: 1, borderColor: palette.border, padding: 12, fontSize: 14, minHeight: 64, textAlignVertical: 'top',
          }}
        />
        <View style={{marginTop: spacing.lg}}>
          <Button
            title={`Start discussion${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
            onPress={start}
            disabled={!participants.length || !runner.hasBackend}
          />
        </View>
      </View>
    </ScrollView>
  );

  /* ------------------------------- Chat view ------------------------------ */
  const renderEntry = (e: TranscriptEntry, idx: number) => {
    if (e.participantId === 'user') {
      return (
        <View key={idx} style={{alignItems: 'flex-end', marginBottom: 14}}>
          <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont, marginRight: 2}]}>YOU</Text>
          <View style={{
            marginTop: 3, maxWidth: '86%', padding: 10, borderRadius: 12,
            backgroundColor: palette.accentMuted ?? palette.surfaceAlt,
            borderWidth: 1, borderColor: palette.border,
          }}>
            <MarkdownText text={e.text} />
          </View>
        </View>
      );
    }
    const p = byId[e.participantId];
    const color = p?.color ?? palette.accent;
    return (
      <View key={idx} style={{flexDirection: 'row', marginBottom: 14}}>
        <PersonaBadge icon={p?.icon ?? 'bot'} color={color} badge={30} size={15} />
        <View style={{flex: 1, marginLeft: 10}}>
          <Text style={{color, fontSize: 12, fontWeight: '700'}}>{e.speaker}</Text>
          <View style={{
            marginTop: 3, padding: 10, borderRadius: 12,
            backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
          }}>
            <MarkdownText text={e.text} />
          </View>
        </View>
      </View>
    );
  };

  const speaking = speakingId ? byId[speakingId] : null;

  const renderChat = () => (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <UsersIcon size={18} color={palette.accent} />
        <View style={{flexDirection: 'row', flex: 1, marginLeft: 10}}>
          {participants.slice(0, 8).map(pp => {
            const src = byId[pp.id];
            return (
              <View key={pp.id} style={{marginRight: -6}}>
                <PersonaBadge icon={src?.icon ?? 'bot'} color={src?.color ?? palette.accent} badge={26} size={13} />
              </View>
            );
          })}
        </View>
        <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont, marginRight: 10}]}>
          {mode === 'moderated' ? 'MOD' : 'RR'}{voiceEnabled ? ' · 🔊' : ''}
        </Text>
        <TouchableOpacity onPress={resetToBuilder} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <XIcon size={20} color={palette.textDim} />
        </TouchableOpacity>
      </View>

      {/* Transcript */}
      <ScrollView ref={scrollRef} style={{flex: 1}} contentContainerStyle={{padding: spacing.lg, paddingBottom: 8}}>
        {transcript.map(renderEntry)}

        {speaking ? (
          <View style={{flexDirection: 'row', marginBottom: 14}}>
            <PersonaBadge icon={speaking.icon} color={speaking.color} badge={30} size={15} />
            <View style={{flex: 1, marginLeft: 10}}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Text style={{color: speaking.color, fontSize: 12, fontWeight: '700'}}>{speaking.name}</Text>
                <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: speaking.color, marginLeft: 6}} />
              </View>
              <View style={{
                marginTop: 3, padding: 10, borderRadius: 12,
                backgroundColor: palette.surface, borderWidth: 1, borderColor: speaking.color + '55',
              }}>
                {liveText
                  ? <MarkdownText text={liveText} />
                  : <Text style={[type.body, {color: palette.textDim, fontStyle: 'italic'}]}>thinking…</Text>}
              </View>
            </View>
          </View>
        ) : running ? (
          <Text style={[type.body, {color: palette.textDim, fontStyle: 'italic', marginBottom: 14}]}>…</Text>
        ) : null}

        {error ? (
          <Text style={[type.mono, {color: palette.error, fontSize: 11, fontFamily: monoFont, marginBottom: 10}]}>{error}</Text>
        ) : null}
      </ScrollView>

      {/* Controls + composer */}
      <View style={{borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md}}>
        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8}}>
          {running ? (
            <TouchableOpacity onPress={stop} style={{flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: palette.error}}>
              <View style={{width: 10, height: 10, backgroundColor: palette.error}} />
              <Text style={[type.mono, {color: palette.error, fontSize: 10, fontFamily: monoFont}]}>STOP</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => void continueRounds(1)} style={{flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: palette.accent, backgroundColor: palette.accentMuted ?? palette.surfaceAlt}}>
              <ChevronRightIcon size={13} color={palette.accent} />
              <Text style={[type.mono, {color: palette.accent, fontSize: 10, fontFamily: monoFont}]}>CONTINUE</Text>
            </TouchableOpacity>
          )}
          {voiceEnabled ? (
            <TouchableOpacity
              onPress={() => setMuteThisRound(m => !m)}
              style={{flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: muteThisRound ? palette.accent : palette.border, backgroundColor: muteThisRound ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent'}}>
              <Volume2Icon size={13} color={muteThisRound ? palette.accent : palette.textDim} />
              <Text style={[type.mono, {color: muteThisRound ? palette.accent : palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                {muteThisRound ? 'MUTED' : 'MUTE'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <View style={{flex: 1}} />
          <AtSignIcon size={13} color={palette.textDim} />
          <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>name to call on</Text>
        </View>

        <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 8}}>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder="Interject, or @mention someone…"
            placeholderTextColor={palette.textDim}
            multiline
            style={{
              flex: 1, backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: 10,
              borderWidth: 1, borderColor: palette.border, paddingHorizontal: 12, paddingVertical: 10,
              fontSize: 14, maxHeight: 120,
            }}
          />
          <TouchableOpacity
            onPress={send}
            disabled={running || !composer.trim()}
            style={{
              width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
              backgroundColor: (running || !composer.trim()) ? palette.surfaceAlt : palette.accent,
            }}>
            <PlayIcon size={18} color={(running || !composer.trim()) ? palette.textDim : palette.bg} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      {started ? renderChat() : renderBuilder()}
    </View>
  );
}
