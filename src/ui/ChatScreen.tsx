/**
 * Chat tab — streaming conversation with per-turn options.
 *
 * The input area shows:
 *   - Active option chips (model, reasoning, workspace, profile, agent) — tap
 *     to expand the picker.
 *   - Pending attachments strip with thumbnails.
 *   - Compose row with text input + attach buttons + send/stop/steer.
 */
import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Text, Animated, Clipboard, Modal, ScrollView, Alert,
} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {
  ChevronLeftIcon, SendIcon, StopIcon, ArrowUpRightIcon, LightbulbIcon,
  CopyIcon, CheckIcon, PaperclipIcon, CameraIcon, XIcon, CpuIcon,
  ChevronDownIcon, CompassIcon, UserIcon, RefreshIcon,
  Volume2Icon, VolumeXIcon, MicIcon, MicOffIcon, WaveIcon,
} from './icons';
import MarkdownText from './MarkdownText';
import {launchImageLibrary, launchCamera} from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import {useVoice} from './useVoice';

interface ToolEvent {
  name: string;
  ts: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

const REASONING_OPTIONS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

export default function ChatScreen() {
  const {
    engine, currentSession, messages, streaming, streamedText, streamedReasoning,
    sendPrompt, abortStream, steerStream, currentAgent, setScreen,
    chatOptions, setChatOptions, activeWorkspace, activeProfile,
    pendingAttachments, addAttachment, removeAttachment,
    attachTextFile, attachImageFile,
  } = useApp();
  const {palette, spacing, type} = useTheme();
  const [draft, setDraft] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [steerOpen, setSteerOpen] = useState(false);
  const [steerDraft, setSteerDraft] = useState('');
  const [busyAttach, setBusyAttach] = useState(false);
  const listRef = useRef<FlatList>(null);
  const cursor = useRef(new Animated.Value(0)).current;
  const isMono = palette.type === 'mono';
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const fontFamily = isMono ? monoFont : undefined;

  // ----- Voice Assistant MODE (MiniMax) -----
  const voice = useVoice();
  const [voiceMode, setVoiceMode] = useState(false);
  const spokenRef = useRef(0);

  // Auto-speak the newest completed assistant reply while Voice Mode is on.
  useEffect(() => {
    if (!voiceMode || !voice.settings.autoSpeak || streaming) return;
    if (messages.length <= spokenRef.current) return;
    const last = messages[messages.length - 1];
    spokenRef.current = messages.length;
    if (last && last.role === 'assistant' && last.text && last.text.trim()) {
      void voice.speak(last.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, streaming, voiceMode]);

  // Mirror the live transcript into the composer while listening.
  useEffect(() => {
    if (voice.listening) setDraft(voice.transcript);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.transcript, voice.listening]);

  const onToggleVoiceMode = useCallback(() => {
    if (!voice.ready) {
      Alert.alert('Voice needs MiniMax', 'Add your MiniMax API key in Settings → AI to use the Voice Assistant.');
      return;
    }
    setVoiceMode(v => {
      const next = !v;
      if (next) {
        spokenRef.current = messages.length;
      } else {
        void voice.stopSpeaking();
        void voice.stopListening();
      }
      return next;
    });
  }, [voice, messages.length]);

  const onMic = useCallback(async () => {
    if (voice.listening) { await voice.stopListening(); return; }
    setDraft('');
    await voice.startListening({
      onFinal: (t) => {
        const clean = t.trim();
        if (clean && !streaming) {
          setDraft('');
          void sendPrompt(clean);
        }
      },
    });
  }, [voice, streaming, sendPrompt]);

  useEffect(() => {
    if (!streaming) {
      cursor.stopAnimation();
      cursor.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursor, {toValue: 1, duration: 500, useNativeDriver: false}),
        Animated.timing(cursor, {toValue: 0, duration: 500, useNativeDriver: false}),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      cursor.setValue(0);
    };
  }, [streaming, cursor]);

  useEffect(() => {
    if (!engine) return;
    const off = engine.onEvent((type: string, params: any) => {
      if (params?.session_id && currentSession && params.session_id !== currentSession) return;
      if (type === 'tool.start') {
        const name = params.payload?.name ?? 'tool';
        setToolEvents(prev => [...prev.slice(-4), {name, ts: Date.now()}]);
      }
    });
    return off;
  }, [engine, currentSession]);

  const displayMessages = (streaming || streamedText || streamedReasoning)
    ? [...messages, {
        role: 'assistant' as const,
        text: streamedText,
        reasoning: streamedReasoning || undefined,
        ts: Date.now(),
      }]
    : messages;

  const onSend = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    setToolEvents([]);
    // Attach any pending files/images first (best-effort).
    for (const att of pendingAttachments) {
      try {
        if (att.kind === 'image') {
          // image already base64 cached on the attachment record? for now,
          // the user adds the file path; we read & send.
        }
      } catch {/* fine */}
    }
    void sendPrompt(text);
  };

  const onPickImage = useCallback(async (useCamera: boolean) => {
    if (busyAttach) return;
    setBusyAttach(true);
    try {
      const launcher = useCamera ? launchCamera : launchImageLibrary;
      const res = await launcher({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.7,
        maxWidth: 1600,
        maxHeight: 1600,
      });
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (!asset?.base64) return;
      const name = asset.fileName ?? `photo-${Date.now()}.jpg`;
      addAttachment({kind: 'image', name, size: asset.fileSize});
      try {
        await attachImageFile(name, asset.base64, asset.type ?? 'image/jpeg');
      } catch {/* best-effort */}
    } catch (e: any) {
      Alert.alert('Image pick failed', e?.message ?? String(e));
    } finally {
      setBusyAttach(false);
    }
  }, [busyAttach, addAttachment, attachImageFile]);

  const onPickFile = useCallback(async () => {
    if (busyAttach) return;
    setBusyAttach(true);
    try {
      const file = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.allFiles],
        copyTo: 'cachesDirectory',
      });
      if (!file.fileCopyUri && !file.uri) return;
      const uri = (file.fileCopyUri ?? file.uri) as string;
      let content = '';
      try {
        // Best-effort: read via fetch (RN supports file:// on Android).
        const res = await fetch(uri);
        content = await res.text();
      } catch {
        // Binary file — surface the path as text so the server knows about it.
        Alert.alert('Binary file', 'Text content only is supported in this build. The file path is recorded as a placeholder.');
        content = `[binary:${file.name ?? file.type}]`;
      }
      const name = file.name ?? `file-${Date.now()}`;
      addAttachment({kind: 'file', name, size: file.size ?? undefined});
      try {
        await attachTextFile(name, content, file.type ?? 'text/plain');
      } catch {/* fine */}
    } catch (e: any) {
      if (DocumentPicker.isCancel(e)) return;
      Alert.alert('File pick failed', e?.message ?? String(e));
    } finally {
      setBusyAttach(false);
    }
  }, [busyAttach, addAttachment, attachTextFile]);

  const onSteer = () => {
    const text = steerDraft.trim();
    if (!text) return;
    steerStream(text);
    setSteerDraft('');
    setSteerOpen(false);
  };

  if (!currentSession) return <EmptyState setScreen={setScreen} />;

  const agent = currentAgent;
  const AgentIcon = agent ? agent.icon : null;
  const agentPrefix = agent ? agent.name.toUpperCase().slice(0, 3) : 'GEN';
  const accent = agent ? agent.color : palette.accent;

  const optionChipSummary = [
    chatOptions.modelLabel === 'auto' ? null : (chatOptions.model ?? null),
    chatOptions.reasoningEffort ? `think:${chatOptions.reasoningEffort}` : null,
    activeWorkspace ? `cwd:${shortPath(activeWorkspace)}` : null,
    activeProfile ? `@${activeProfile}` : null,
  ].filter(Boolean).join(' · ') || 'auto · think:medium';

  return (
    <KeyboardAvoidingView
      style={{flex: 1, backgroundColor: palette.bg}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={64}>

      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <TouchableOpacity onPress={() => setScreen('home')} style={{padding: 4, marginRight: 8}}>
          <ChevronLeftIcon size={20} color={palette.textMuted} />
        </TouchableOpacity>
        <View style={{flex: 1}}>
          <Text style={[type.h2, {fontSize: 13, letterSpacing: 0.5}]}>
            {agent ? agent.name.toUpperCase() : 'CHAT'}
          </Text>
          <Text style={[type.monoMuted, {marginTop: 2, fontSize: 10}]}>
            {currentSession.slice(0, 8)}…
          </Text>
        </View>
        {voice.minimaxSelected ? (
          <TouchableOpacity
            onPress={onToggleVoiceMode}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              paddingHorizontal: 8, height: 28,
              borderWidth: 1,
              borderColor: voiceMode ? palette.accent : palette.border,
              backgroundColor: voiceMode ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
              marginRight: AgentIcon ? 8 : 0,
            }}>
            {voiceMode ? <Volume2Icon size={13} color={palette.accent} /> : <VolumeXIcon size={13} color={palette.textDim} />}
            <Text style={[type.mono, {color: voiceMode ? palette.accent : palette.textDim, fontSize: 9, fontFamily: monoFont}]}>
              VOICE
            </Text>
          </TouchableOpacity>
        ) : null}
        {AgentIcon ? (
          <View style={{
            width: 28, height: 28,
            borderWidth: 1, borderColor: accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <AgentIcon size={14} color={accent} />
          </View>
        ) : null}
      </View>

      {/* Per-turn option chips */}
      <TouchableOpacity
        onPress={() => setPickerOpen(true)}
        activeOpacity={0.7}
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: spacing.lg, paddingVertical: 8,
          borderBottomWidth: 1, borderBottomColor: palette.border,
          backgroundColor: palette.surfaceAlt,
        }}>
        <CpuIcon size={12} color={palette.textDim} />
        <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginLeft: 6, flex: 1, fontFamily: monoFont}]}
          numberOfLines={1}>
          {optionChipSummary}
        </Text>
        <ChevronDownIcon size={12} color={palette.textDim} />
      </TouchableOpacity>

      {/* Voice Assistant MODE banner */}
      {voiceMode ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: spacing.lg, paddingVertical: 8,
          borderBottomWidth: 1, borderBottomColor: palette.accent,
          backgroundColor: palette.accentMuted ?? palette.surfaceAlt,
        }}>
          {voice.listening ? <MicIcon size={13} color={palette.accent} /> : <Volume2Icon size={13} color={palette.accent} />}
          <Text style={[type.mono, {color: palette.accent, fontSize: 10, marginLeft: 8, flex: 1, fontFamily: monoFont}]} numberOfLines={1}>
            VOICE ASSISTANT · {voice.listening ? 'LISTENING…' : voice.speaking ? 'SPEAKING…' : (voice.settings.useClonedVoice ? 'CLONED VOICE' : voice.settings.speechModel)}
          </Text>
          {voice.speaking ? (
            <TouchableOpacity onPress={() => void voice.stopSpeaking()} hitSlop={{top:6,bottom:6,left:6,right:6}} style={{padding: 4}}>
              <StopIcon size={13} color={palette.error} filled />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {voiceMode && !voice.audioAvailable ? (
        <View style={{paddingHorizontal: spacing.lg, paddingVertical: 6, backgroundColor: palette.surfaceAlt}}>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>
            audio module not linked — run a native rebuild to enable playback / mic
          </Text>
        </View>
      ) : null}

      {/* Attachments strip */}
      {pendingAttachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{paddingHorizontal: spacing.lg, paddingVertical: 6, gap: 8}}
          style={{borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surfaceAlt}}>
          {pendingAttachments.map(a => (
            <View
              key={a.id}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingLeft: 8, paddingRight: 4, paddingVertical: 4,
                backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
              }}>
              {a.kind === 'image'
                ? <CameraIcon size={12} color={palette.accent} />
                : <PaperclipIcon size={12} color={palette.accent} />}
              <Text style={[type.mono, {color: palette.text, fontSize: 10, marginHorizontal: 6, fontFamily: monoFont}]} numberOfLines={1}>
                {a.name}
              </Text>
              <TouchableOpacity onPress={() => removeAttachment(a.id)} hitSlop={{top:6, bottom:6, left:6, right:6}} style={{padding: 4}}>
                <XIcon size={12} color={palette.textDim} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={displayMessages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({item, index}) => (
          <Message
            role={item.role}
            text={item.text}
            reasoning={item.reasoning}
            usage={item.usage}
            streaming={streaming && index === displayMessages.length - 1 && item.role === 'assistant'}
            cursor={cursor}
            agentPrefix={agentPrefix}
            fontFamily={fontFamily}
            ts={item.ts}
          />
        )}
        contentContainerStyle={{padding: spacing.lg, paddingBottom: 12}}
        onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
        ListFooterComponent={
          toolEvents.length ? (
            <View style={{marginTop: spacing.md}}>
              {toolEvents.map((t, i) => (
                <ToolLine key={i} name={t.name} ts={t.ts} fontFamily={fontFamily} />
              ))}
            </View>
          ) : null
        }
      />

      {/* Composer */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        borderTopWidth: 1, borderTopColor: palette.border,
        backgroundColor: palette.bg,
      }}>
        <TouchableOpacity onPress={onPickFile} style={{padding: 6, marginBottom: 6}} hitSlop={{top:6, bottom:6, left:6, right:6}}>
          <PaperclipIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onPickImage(false)} style={{padding: 6, marginBottom: 6, marginLeft: 2}} hitSlop={{top:6, bottom:6, left:6, right:6}}>
          <CameraIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
        {voiceMode ? (
          <TouchableOpacity onPress={() => void onMic()} style={{padding: 6, marginBottom: 6, marginLeft: 2}} hitSlop={{top:6, bottom:6, left:6, right:6}}>
            {voice.listening
              ? <MicIcon size={16} color={palette.accent} />
              : <MicOffIcon size={16} color={palette.textDim} />}
          </TouchableOpacity>
        ) : null}
        <Text style={[type.mono, {color: palette.textMuted, paddingBottom: 12, marginLeft: 8, fontSize: 14}]}>›</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="message…"
          placeholderTextColor={palette.textGhost}
          editable={!streaming}
          multiline
          style={{
            flex: 1, color: palette.text,
            paddingVertical: 10, fontSize: 14,
            fontFamily, letterSpacing: 0,
            maxHeight: 120, marginLeft: 6,
          }}
        />
        {streaming ? (
          <>
            <TouchableOpacity onPress={() => setSteerOpen(true)} style={{padding: 6, marginBottom: 6, marginRight: 4}} hitSlop={{top:6, bottom:6, left:6, right:6}}>
              <CompassIcon size={16} color={palette.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={abortStream} style={{padding: 6, marginBottom: 6}}>
              <StopIcon size={14} color={palette.error} filled />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              onPress={async () => {
                try {
                  const text: string = await Clipboard.getString();
                  if (text) setDraft(prev => prev ? prev + ' ' + text : text);
                } catch {/* clipboard not available */}
              }}
              style={{padding: 6, marginBottom: 6, marginRight: 2}}>
              <Text style={[type.mono, {color: palette.textDim, fontSize: 12}]}>⌘V</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!draft.trim()}
              onPress={onSend}
              style={{padding: 6, marginBottom: 6}}>
              {draft.trim()
                ? <ArrowUpRightIcon size={18} color={palette.accent} />
                : <SendIcon size={16} color={palette.textGhost} />}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Steer modal */}
      <Modal visible={steerOpen} animationType="fade" transparent onRequestClose={() => setSteerOpen(false)}>
        <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'}}>
          <View style={{
            backgroundColor: palette.bg,
            borderTopWidth: 1, borderColor: palette.border,
            padding: spacing.lg,
          }}>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md}}>
              <CompassIcon size={16} color={palette.accent} />
              <Text style={[type.h2, {flex: 1, marginLeft: 8, fontSize: 13, letterSpacing: 0.5}]}>STEER MID-TURN</Text>
              <TouchableOpacity onPress={() => setSteerOpen(false)} style={{padding: 6}}>
                <XIcon size={18} color={palette.textDim} />
              </TouchableOpacity>
            </View>
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginBottom: spacing.sm}]}>
              Inject guidance without aborting. Applied at the next tool-call boundary.
            </Text>
            <TextInput
              value={steerDraft}
              onChangeText={setSteerDraft}
              placeholder="Be more concise…"
              placeholderTextColor={palette.textGhost}
              multiline
              autoFocus
              style={{
                color: palette.text, fontSize: 14, padding: 10,
                backgroundColor: palette.surfaceAlt,
                borderWidth: 1, borderColor: palette.border,
                minHeight: 70, textAlignVertical: 'top',
              }}
            />
            <TouchableOpacity
              onPress={onSteer}
              disabled={!steerDraft.trim()}
              style={{
                marginTop: spacing.md, paddingVertical: 12,
                alignItems: 'center',
                backgroundColor: steerDraft.trim() ? palette.accent : palette.surfaceAlt,
              }}>
              <Text style={{
                color: steerDraft.trim() ? palette.bg : palette.textDim,
                fontSize: 13, fontWeight: '600',
              }}>STEER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Options picker modal */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'}}>
          <View style={{
            backgroundColor: palette.bg,
            borderTopWidth: 1, borderColor: palette.border,
            padding: spacing.lg,
            maxHeight: '85%',
          }}>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md}}>
              <CpuIcon size={16} color={palette.accent} />
              <Text style={[type.h2, {flex: 1, marginLeft: 8, fontSize: 13, letterSpacing: 0.5}]}>RUN OPTIONS</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} style={{padding: 6}}>
                <XIcon size={18} color={palette.textDim} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">

              {/* Model */}
              <PickerSection title="MODEL">
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                  <Chip
                    label="auto"
                    active={chatOptions.modelLabel === 'auto'}
                    onPress={() => setChatOptions({...chatOptions, model: undefined, modelLabel: 'auto'})}
                  />
                  {chatOptions.model && chatOptions.modelLabel !== 'auto' ? (
                    <Chip label={chatOptions.model} active onPress={() => {}} />
                  ) : null}
                </View>
                <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginTop: 6}]}>
                  Set a custom model in the Models tab.
                </Text>
              </PickerSection>

              {/* Reasoning */}
              <PickerSection title="REASONING">
                <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                  {REASONING_OPTIONS.map(r => (
                    <Chip
                      key={r}
                      label={r}
                      active={(chatOptions.reasoningEffort ?? 'medium') === r}
                      onPress={() => setChatOptions({...chatOptions, reasoningEffort: r as any})}
                    />
                  ))}
                </View>
              </PickerSection>

              {/* Workspace + Profile summary */}
              <PickerSection title="CONTEXT">
                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                  <CompassIcon size={12} color={palette.textDim} />
                  <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginLeft: 6, flex: 1, fontFamily: monoFont}]}>
                    workspace: {activeWorkspace ?? '(default)'}
                  </Text>
                </View>
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4}}>
                  <UserIcon size={12} color={palette.textDim} />
                  <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginLeft: 6, flex: 1, fontFamily: monoFont}]}>
                    profile: {activeProfile ?? '(default)'}
                  </Text>
                </View>
                <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 10, marginTop: 4}]}>
                  Change in Profiles / Workspace tabs.
                </Text>
              </PickerSection>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function shortPath(p: string): string {
  if (p.length < 28) return p;
  return '…' + p.slice(-26);
}

const PickerSection: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{marginBottom: spacing.md}}>
      <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>{title}</Text>
      {children}
    </View>
  );
};

const Chip: React.FC<{label: string; active?: boolean; onPress: () => void}> = ({label, active, onPress}) => {
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 8,
        borderWidth: 1,
        borderColor: active ? palette.accent : palette.border,
        backgroundColor: active ? palette.accentMuted ?? palette.surfaceAlt : 'transparent',
      }}>
      <Text style={[type.mono, {
        color: active ? palette.accent : palette.textDim,
        fontSize: 11, fontFamily: monoFont,
      }]}>{label.toUpperCase()}</Text>
    </TouchableOpacity>
  );
};

const EmptyState: React.FC<{setScreen: (s: any) => void}> = ({setScreen}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{flex: 1, backgroundColor: palette.bg, justifyContent: 'center', alignItems: 'center', padding: 32}}>
      <Text style={type.label}>NO ACTIVE SESSION</Text>
      <View style={{height: 1, width: 80, backgroundColor: palette.border, marginVertical: spacing.lg}} />
      <Text style={[type.body, {color: palette.textMuted, textAlign: 'center', maxWidth: 280, fontSize: 12}]}>
        Start a new conversation or pick an agent.
      </Text>
      <View style={{height: 1, width: 80, backgroundColor: palette.border, marginVertical: spacing.lg}} />
      <TouchableOpacity
        onPress={() => setScreen('home')}
        style={{flexDirection: 'row', alignItems: 'center', padding: spacing.sm}}>
        <Text style={[type.h2, {fontSize: 12, color: palette.accent}]}>RETURN TO HOME</Text>
        <Text style={[type.mono, {marginLeft: 8, color: palette.textDim}]}>↩</Text>
      </TouchableOpacity>
    </View>
  );
};

const ToolLine: React.FC<{name: string; ts: number; fontFamily?: any}> = ({name, ts, fontFamily}) => {
  const {type, palette} = useTheme();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 2}}>
      <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, fontFamily}]}>
        [{formatTime(ts)}]
      </Text>
      <Text style={[type.monoMuted, {marginLeft: 8, color: palette.success, fontSize: 10, fontFamily}]}>⎔</Text>
      <Text style={[type.monoMuted, {marginLeft: 8, color: palette.textMuted, fontSize: 10, fontFamily, flex: 1}]}>
        {name}
      </Text>
    </View>
  );
};

const CopyButton: React.FC<{text: string; fontFamily?: any}> = ({text, fontFamily}) => {
  const {palette, type} = useTheme();
  const [copied, setCopied] = useState(false);
  return (
    <TouchableOpacity
      onPress={() => {
        try { Clipboard.setString(text); } catch {/* not available */}
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
      style={{flexDirection: 'row', alignItems: 'center', padding: 2}}>
      {copied
        ? <CheckIcon size={11} color={palette.success} />
        : <CopyIcon size={11} color={palette.textDim} />}
      <Text style={[type.monoMuted, {marginLeft: 4, color: copied ? palette.success : palette.textDim, fontSize: 9, fontFamily}]}>
        {copied ? 'COPIED' : 'COPY'}
      </Text>
    </TouchableOpacity>
  );
};

const ThinkingBlock: React.FC<{
  reasoning: string;
  streaming: boolean;
  fontFamily?: any;
}> = ({reasoning, streaming, fontFamily}) => {
  const {palette, spacing, type} = useTheme();
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false);
    if (!wasStreaming.current && streaming) setOpen(true);
    wasStreaming.current = streaming;
  }, [streaming]);

  return (
    <View style={{
      marginBottom: spacing.sm,
      borderWidth: 1, borderColor: palette.border,
      borderRadius: 4, backgroundColor: palette.surface, overflow: 'hidden',
    }}>
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.7}
        style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 8}}>
        <LightbulbIcon size={12} color={palette.highlight} />
        <Text style={[type.label, {marginLeft: 8, color: palette.textMuted}]}>
          {streaming ? 'THINKING…' : 'THOUGHT PROCESS'}
        </Text>
        <View style={{flex: 1}} />
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 9, marginRight: 6, fontFamily}]}>
          {open ? 'HIDE' : 'SHOW'}
        </Text>
        <View style={{transform: [{rotate: open ? '90deg' : '0deg'}]}}>
          <ChevronLeftIcon size={14} color={palette.textDim} />
        </View>
      </TouchableOpacity>
      {open ? (
        <View style={{
          paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: 4,
          borderTopWidth: 1, borderTopColor: palette.border,
        }}>
          <MarkdownText text={reasoning} color={palette.textMuted} fontFamily={fontFamily} muted />
        </View>
      ) : null}
    </View>
  );
};

const Message: React.FC<{
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  usage?: {output: number; context_percent: number};
  streaming: boolean;
  cursor: Animated.Value;
  agentPrefix: string;
  fontFamily?: any;
  ts: number;
}> = ({role, text, reasoning, usage, streaming, cursor, agentPrefix, fontFamily, ts}) => {
  const {palette, spacing, type} = useTheme();
  const isUser = role === 'user';
  const cursorOpacity = streaming
    ? cursor.interpolate({inputRange: [0, 1], outputRange: [0, 1]})
    : 0;

  return (
    <View style={{marginBottom: spacing.lg}}>
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 4}}>
        <Text style={[type.monoMuted, {color: isUser ? palette.textMuted : palette.success, fontSize: 10, fontFamily}]}>
          {isUser ? '› YOU' : `▸ ${agentPrefix}`}
        </Text>
        <Text style={[type.monoMuted, {marginLeft: 8, color: palette.textGhost, fontSize: 10, fontFamily}]}>
          {formatTime(ts)}
        </Text>
        {usage ? (
          <Text style={[type.monoMuted, {marginLeft: 8, color: palette.textGhost, fontSize: 10, fontFamily}]}>
            ·  {usage.output} OUT  ·  {usage.context_percent}% CTX
          </Text>
        ) : null}
        {!isUser && !streaming && text ? (
          <>
            <View style={{flex: 1}} />
            <CopyButton text={text} fontFamily={fontFamily} />
          </>
        ) : null}
      </View>

      {!isUser && reasoning ? (
        <View style={{paddingLeft: 12}}>
          <ThinkingBlock reasoning={reasoning} streaming={streaming} fontFamily={fontFamily} />
        </View>
      ) : null}

      <View style={{paddingLeft: isUser ? 0 : 12}}>
        {isUser ? (
          <Text selectable style={{color: palette.text, fontSize: 14, lineHeight: 22, fontFamily, textAlign: 'right'}}>
            {text}
          </Text>
        ) : text ? (
          <MarkdownText text={text} color={palette.text} fontFamily={fontFamily} />
        ) : streaming && !reasoning ? (
          <Text style={{color: palette.textDim, fontSize: 14, fontFamily}}>…</Text>
        ) : null}
        {streaming && !isUser ? (
          <Animated.Text style={{color: palette.accent, opacity: cursorOpacity, fontSize: 14, fontFamily}}>▍</Animated.Text>
        ) : null}
      </View>
    </View>
  );
};
