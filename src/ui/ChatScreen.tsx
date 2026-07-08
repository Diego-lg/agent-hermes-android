/**
 * Chat tab — industrial / terminal-style.
 *
 * - No bubble backgrounds, no per-message icons
 * - Assistant: indented with a `▸` prefix in dim text
 * - User: flush right, `›` prompt prefix in muted
 * - Tool events: monospace log lines: `[hh:mm:ss] ⎔ terminal ls -la`
 * - Streaming: blinking `▍` cursor at the end of in-flight text
 * - Composer: no border, just a hairline top + bare `› message…` placeholder
 * - Header: agent name in monospace + small agent tag, no avatar
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Text, Animated,
} from 'react-native';
import {useApp} from './AppContext';
import {palette, spacing, type} from './theme';
import {agentById} from '../agents/catalog';
import {ChevronLeftIcon, SendIcon, StopIcon, MicIcon, MicOffIcon, ArrowUpRightIcon} from './icons';

interface ToolEvent {
  name: string;
  ts: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

export default function ChatScreen() {
  const {
    client, currentSession, messages, streaming, streamedText,
    sendPrompt, abortStream, currentAgent, setScreen,
  } = useApp();
  const [draft, setDraft] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [listening, setListening] = useState(false);
  const listRef = useRef<FlatList>(null);
  const cursor = useRef(new Animated.Value(0)).current;

  // Blinking cursor while streaming
  useEffect(() => {
    if (streaming) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(cursor, {toValue: 1, duration: 500, useNativeDriver: false}),
          Animated.timing(cursor, {toValue: 0, duration: 500, useNativeDriver: false}),
        ]),
      ).start();
    }
  }, [streaming, cursor]);

  useEffect(() => {
    if (!client) return;
    const off = client.onEvent((type, params) => {
      if (params?.session_id && currentSession && params.session_id !== currentSession) return;
      if (type === 'tool.start') {
        const name = params.payload?.name ?? 'tool';
        setToolEvents(prev => [...prev.slice(-4), {name, ts: Date.now()}]);
      }
    });
    return off;
  }, [client, currentSession]);

  const displayMessages = streamedText
    ? [...messages, {role: 'assistant' as const, text: streamedText, ts: Date.now()}]
    : messages;

  const onSend = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    setToolEvents([]);
    void sendPrompt(text);
  };

  const onMicPress = () => {
    // @ts-ignore
    const SR = (global as any).SpeechRecognition || (global as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e: any) => setDraft(prev => (prev ? prev + ' ' : '') + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  };

  if (!currentSession) {
    return <EmptyState setScreen={setScreen} />;
  }

  const agent = currentAgent;
  const AgentIcon = agent ? agent.icon : null;
  const agentPrefix = agent ? agent.name.toUpperCase().slice(0, 3) : 'GEN';
  const accent = agent ? agent.color : palette.on;

  return (
    <KeyboardAvoidingView
      style={{flex: 1, backgroundColor: palette.bg}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={64}>

      {/* Header — monospace, hairline bottom */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.hairline,
      }}>
        <TouchableOpacity onPress={() => setScreen('home')} style={{padding: 4, marginRight: 8}}>
          <ChevronLeftIcon size={20} color={palette.textMuted} />
        </TouchableOpacity>
        <View style={{flex: 1}}>
          <Text style={[type.h2, {fontSize: 13, letterSpacing: 0.5}]}>
            {agent ? agent.name.toUpperCase() : 'CHAT'}
          </Text>
          <Text style={[type.monoMuted, {marginTop: 2, fontSize: 10}]}>
            {currentSession.slice(0, 8)}…  ·  {formatTime(Date.now())}
          </Text>
        </View>
        {AgentIcon ? (
          <View style={{
            width: 28, height: 28,
            borderWidth: 1, borderColor: accent,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <AgentIcon size={14} color={accent} />
          </View>
        ) : (
          <View style={{
            width: 28, height: 28,
            borderWidth: 1, borderColor: palette.hairlineStrong,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={[type.mono, {fontSize: 10}]}>{agentPrefix}</Text>
          </View>
        )}
      </View>

      {/* Messages — terminal log */}
      <FlatList
        ref={listRef}
        data={displayMessages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({item, index}) => (
          <Message
            role={item.role}
            text={item.text}
            usage={item.usage}
            isLast={index === displayMessages.length - 1}
            streaming={streaming && index === displayMessages.length - 1 && item.role === 'assistant'}
            cursor={cursor}
            agentPrefix={agentPrefix}
          />
        )}
        contentContainerStyle={{padding: spacing.lg, paddingBottom: 12}}
        onContentSizeChange={() => listRef.current?.scrollToEnd({animated: true})}
        ListFooterComponent={
          toolEvents.length ? (
            <View style={{marginTop: spacing.md}}>
              {toolEvents.map((t, i) => (
                <ToolLine key={i} name={t.name} ts={t.ts} />
              ))}
            </View>
          ) : null
        }
      />

      {/* Composer — hairline, no border, terminal-prompt placeholder */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        borderTopWidth: 1, borderTopColor: palette.hairline,
        backgroundColor: palette.bg,
        gap: spacing.md,
      }}>
        <Text style={[type.mono, {color: palette.textMuted, paddingBottom: 12, fontSize: 14}]}>›</Text>
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
            fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
            letterSpacing: 0,
            maxHeight: 120,
          }}
        />
        <TouchableOpacity
          onPress={onMicPress}
          style={{padding: 6, marginBottom: 4}}>
          {listening
            ? <MicOffIcon size={16} color={palette.error} />
            : <MicIcon size={16} color={palette.textDim} />}
        </TouchableOpacity>
        {streaming ? (
          <TouchableOpacity
            onPress={abortStream}
            style={{padding: 6, marginBottom: 4}}>
            <StopIcon size={14} color={palette.error} filled />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            disabled={!draft.trim()}
            onPress={onSend}
            style={{padding: 6, marginBottom: 4}}>
            {draft.trim()
              ? <ArrowUpRightIcon size={18} color={palette.on} />
              : <SendIcon size={16} color={palette.textGhost} />}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const EmptyState: React.FC<{setScreen: (s: any) => void}> = ({setScreen}) => (
  <View style={{flex: 1, backgroundColor: palette.bg, justifyContent: 'center', alignItems: 'center', padding: 32}}>
    <Text style={type.label}>NO ACTIVE SESSION</Text>
    <View style={{height: 1, width: 80, backgroundColor: palette.hairline, marginVertical: spacing.lg}} />
    <Text style={[type.bodyMuted, {textAlign: 'center', maxWidth: 280, fontSize: 12}]}>
      Start a new conversation or pick an agent.
    </Text>
    <View style={{height: 1, width: 80, backgroundColor: palette.hairline, marginVertical: spacing.lg}} />
    <TouchableOpacity
      onPress={() => setScreen('home')}
      style={{flexDirection: 'row', alignItems: 'center', padding: spacing.sm}}>
      <Text style={[type.h2, {fontSize: 12, color: palette.on}]}>RETURN TO HOME</Text>
      <Text style={[type.mono, {marginLeft: 8, color: palette.textDim}]}>↩</Text>
    </TouchableOpacity>
  </View>
);

const ToolLine: React.FC<{name: string; ts: number}> = ({name, ts}) => (
  <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 2}}>
    <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10}]}>
      [{formatTime(ts)}]
    </Text>
    <Text style={[type.monoMuted, {marginLeft: 8, color: palette.active, fontSize: 10}]}>
      ⎔
    </Text>
    <Text style={[type.monoMuted, {marginLeft: 8, color: palette.textMuted, fontSize: 10, flex: 1}]}>
      {name}
    </Text>
  </View>
);

const Message: React.FC<{
  role: 'user' | 'assistant';
  text: string;
  usage?: {output: number; context_percent: number};
  isLast: boolean;
  streaming: boolean;
  cursor: Animated.Value;
  agentPrefix: string;
}> = ({role, text, usage, isLast, streaming, cursor, agentPrefix}) => {
  const isUser = role === 'user';
  const ts = formatTime(Date.now());

  const cursorOpacity = streaming
    ? cursor.interpolate({inputRange: [0, 1], outputRange: [0, 1]})
    : 0;

  return (
    <View style={{marginBottom: spacing.lg}}>
      {/* Meta line */}
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 4}}>
        <Text style={[type.monoMuted, {color: isUser ? palette.textMuted : palette.active, fontSize: 10}]}>
          {isUser ? '› YOU' : `▸ ${agentPrefix}`}
        </Text>
        <Text style={[type.monoMuted, {marginLeft: 8, color: palette.textGhost, fontSize: 10}]}>
          {ts}
        </Text>
        {usage ? (
          <Text style={[type.monoMuted, {marginLeft: 8, color: palette.textGhost, fontSize: 10}]}>
            ·  {usage.output} OUT  ·  {usage.context_percent}% CTX
          </Text>
        ) : null}
      </View>
      {/* Text */}
      <View style={{paddingLeft: isUser ? 0 : 12}}>
        <Text
          selectable
          style={{
            color: palette.text,
            fontSize: 14, lineHeight: 22,
            fontFamily: Platform.select({ios: 'Menlo', android: 'monospace'}),
            letterSpacing: 0,
            textAlign: isUser ? 'right' : 'left',
          }}>
          {text || (isUser ? '' : ' ')}
          {streaming ? (
            <Animated.Text style={{color: palette.on, opacity: cursorOpacity}}>▍</Animated.Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
};
