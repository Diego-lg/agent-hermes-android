/**
 * Chat tab — streaming conversation. Theme-aware.
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, Text, Animated, Clipboard,
} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ChevronLeftIcon, SendIcon, StopIcon, ArrowUpRightIcon} from './icons';

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
  const {palette, spacing, type} = useTheme();
  const [draft, setDraft] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const listRef = useRef<FlatList>(null);
  const cursor = useRef(new Animated.Value(0)).current;
  const isMono = palette.type === 'mono';
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const fontFamily = isMono ? monoFont : undefined;

  // Blink-loop the streaming caret. Started on `streaming===true`,
  // torn down (stopped + zeroed) when streaming flips back to false so
  // it doesn't keep running and using CPU after the response completes.
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

  if (!currentSession) return <EmptyState setScreen={setScreen} />;

  const agent = currentAgent;
  const AgentIcon = agent ? agent.icon : null;
  const agentPrefix = agent ? agent.name.toUpperCase().slice(0, 3) : 'GEN';
  const accent = agent ? agent.color : palette.accent;

  return (
    <KeyboardAvoidingView
      style={{flex: 1, backgroundColor: palette.bg}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={64}>

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
            borderWidth: 1, borderColor: palette.border,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={[type.mono, {fontSize: 10}]}>{agentPrefix}</Text>
          </View>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={displayMessages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({item, index}) => (
          <Message
            role={item.role}
            text={item.text}
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

      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
        borderTopWidth: 1, borderTopColor: palette.border,
        backgroundColor: palette.bg, gap: spacing.md,
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
            fontFamily, letterSpacing: 0,
            maxHeight: 120,
          }}
        />
        <TouchableOpacity
          onPress={async () => {
            try {
              const text: string = await Clipboard.getString();
              if (text) setDraft(prev => prev ? prev + ' ' + text : text);
            } catch {/* clipboard not available */}
          }}
          style={{padding: 6, marginBottom: 4}}>
          <Text style={[type.mono, {color: palette.textDim, fontSize: 14}]}>⌘V</Text>
        </TouchableOpacity>
        {streaming ? (
          <TouchableOpacity onPress={abortStream} style={{padding: 6, marginBottom: 4}}>
            <StopIcon size={14} color={palette.error} filled />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            disabled={!draft.trim()}
            onPress={onSend}
            style={{padding: 6, marginBottom: 4}}>
            {draft.trim()
              ? <ArrowUpRightIcon size={18} color={palette.accent} />
              : <SendIcon size={16} color={palette.textGhost} />}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

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

const Message: React.FC<{
  role: 'user' | 'assistant';
  text: string;
  usage?: {output: number; context_percent: number};
  streaming: boolean;
  cursor: Animated.Value;
  agentPrefix: string;
  fontFamily?: any;
  ts: number;
}> = ({role, text, usage, streaming, cursor, agentPrefix, fontFamily, ts}) => {
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
      </View>
      <View style={{paddingLeft: isUser ? 0 : 12}}>
        <Text
          selectable
          style={{
            color: palette.text,
            fontSize: 14, lineHeight: 22,
            fontFamily, letterSpacing: 0,
            textAlign: isUser ? 'right' : 'left',
          }}>
          {text || (isUser ? '' : ' ')}
          {streaming ? (
            <Animated.Text style={{color: palette.accent, opacity: cursorOpacity}}>▍</Animated.Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
};
