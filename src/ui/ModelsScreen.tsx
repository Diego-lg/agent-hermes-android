/**
 * ModelsScreen — pick any model/provider the server is configured for.
 *
 * Since the server's `model.list` RPC isn't available, this screen:
 *   1. Shows the model currently in use (from `session.active_list[0].model`).
 *   2. Lists recents and favorites (persisted locally).
 *   3. Lets the user type any custom model id.
 *   4. Falls back to a curated default list when the server is unreachable.
 */
import React, {useCallback, useEffect, useState, useMemo} from 'react';
import {View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, Platform, Alert} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {StarIcon, StarFilled, RefreshIcon, CpuIcon, ChevronRightIcon, CheckIcon, ServerIcon} from './icons';

/** A curated list of common model ids — used as suggestions when the server
 *  hasn't advertised any. The user can add any id and it becomes a "Recent". */
const COMMON_MODELS = [
  {id: 'MiniMax-M3', provider: 'MiniMax'},
  {id: 'MiniMax-Text-01', provider: 'MiniMax'},
  {id: 'claude-sonnet-4', provider: 'Anthropic'},
  {id: 'claude-opus-4', provider: 'Anthropic'},
  {id: 'gpt-4o', provider: 'OpenAI'},
  {id: 'gpt-4-turbo', provider: 'OpenAI'},
  {id: 'o1-preview', provider: 'OpenAI'},
  {id: 'gemini-2.5-pro', provider: 'Google'},
  {id: 'llama-3.3-70b', provider: 'Meta'},
  {id: 'mistral-large', provider: 'Mistral'},
  {id: 'deepseek-r1', provider: 'DeepSeek'},
];

export default function ModelsScreen() {
  const {
    engine, engineClient, serverOnline,
    chatOptions, setChatOptions,
    recentModels, favoriteModels, pushRecentModel, toggleFavoriteModel,
  } = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [draft, setDraft] = useState(chatOptions.model ?? '');
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [serverModels, setServerModels] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [reasoning, setReasoning] = useState<string>('');
  const [personality, setPersonality] = useState<string>('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      // Discover current model + advertised models + server config keys.
      if (engine?.id === 'desktop') {
        const active = await (engine as any).listActiveSessions?.();
        if (active && active[0]?.model) setCurrentModel(active[0].model);
        try {
          const listed = await (engine as any).listModels?.();
          if (Array.isArray(listed)) {
            // Tolerate several shapes.
            const normalized = listed.map((m: any) =>
              typeof m === 'string' ? {id: m, provider: ''} : m,
            );
            setServerModels(normalized);
          }
        } catch {/* fine */}
        try {
          const r = await (engine as any).getConfig?.('reasoning');
          if (r?.value) setReasoning(String(r.value));
        } catch {/* fine */}
        try {
          const p = await (engine as any).getConfig?.('personality');
          if (p?.value) setPersonality(String(p.value));
        } catch {/* fine */}
      }
    } finally {
      setRefreshing(false);
    }
  }, [engine]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setDraft(chatOptions.model ?? ''); }, [chatOptions.model]);

  // Build the visible model list: server-known first, then common catalog,
  // deduped and excluding "auto".
  const catalog = useMemo(() => {
    const set = new Map<string, {id: string; provider: string}>();
    for (const m of serverModels) if (m?.id) set.set(m.id, {id: m.id, provider: m.provider ?? m.vendor ?? ''});
    for (const m of COMMON_MODELS) if (!set.has(m.id)) set.set(m.id, m);
    return Array.from(set.values());
  }, [serverModels]);

  const apply = useCallback(async (modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    setChatOptions({...chatOptions, model: trimmed, modelLabel: trimmed});
    await pushRecentModel(trimmed);
  }, [chatOptions, setChatOptions, pushRecentModel]);

  const setAuto = useCallback(() => {
    setChatOptions({...chatOptions, model: undefined, modelLabel: 'auto'});
  }, [chatOptions, setChatOptions]);

  const onSubmitDraft = () => { void apply(draft); };

  const onSetReasoning = useCallback(async (effort: string) => {
    setReasoning(effort);
    try {
      if (engine?.id === 'desktop') {
        await (engine as any).setConfig?.('reasoning', effort);
      }
    } catch (e: any) {
      Alert.alert('Reasoning change failed', e?.message ?? String(e));
    }
  }, [engine]);

  const REASONING_OPTIONS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>MODELS</Text>
        <TouchableOpacity onPress={load} style={{padding: 6}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <RefreshIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }>
        {/* Current model card */}
        <View style={{padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.border}}>
          <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>CURRENT</Text>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <ServerIcon size={16} color={palette.accent} />
            <Text style={[type.body, {color: palette.text, fontSize: 15, marginLeft: 8, flex: 1}]} numberOfLines={1}>
              {chatOptions.modelLabel === 'auto' || !chatOptions.model
                ? (currentModel ? `${currentModel} (server default)` : 'auto (server default)')
                : chatOptions.model}
            </Text>
            {chatOptions.modelLabel !== 'auto' ? (
              <TouchableOpacity onPress={setAuto} style={{paddingHorizontal: 10, paddingVertical: 6}}>
                <Text style={[type.mono, {color: palette.accent, fontSize: 10, fontFamily: monoFont}]}>USE AUTO</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {!serverOnline ? (
            <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 8, fontFamily: monoFont}]}>
              server offline · showing cached selection
            </Text>
          ) : null}
        </View>

        {/* Custom input */}
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.lg}}>
          <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>CUSTOM MODEL ID</Text>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={onSubmitDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. MiniMax-M3, gpt-4o, …"
              placeholderTextColor={palette.textGhost}
              style={{
                flex: 1, color: palette.text, fontSize: 14,
                fontFamily: monoFont,
                paddingHorizontal: 10, paddingVertical: 10,
                backgroundColor: palette.surfaceAlt,
                borderWidth: 1, borderColor: palette.border,
              }}
            />
            <TouchableOpacity
              onPress={onSubmitDraft}
              disabled={!draft.trim()}
              style={{
                paddingHorizontal: 16, paddingVertical: 10,
                backgroundColor: draft.trim() ? palette.accent : palette.surfaceAlt,
              }}>
              <Text style={{color: draft.trim() ? palette.bg : palette.textDim, fontSize: 13, fontWeight: '600'}}>
                APPLY
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recents */}
        {recentModels.length ? (
          <Section title="RECENTS">
            {recentModels.map(m => (
              <ModelRow
                key={m} m={{id: m, provider: ''}} active={chatOptions.model === m}
                favorite={favoriteModels.includes(m)}
                onApply={() => void apply(m)}
                onToggleFavorite={() => void toggleFavoriteModel(m)}
                monoFont={monoFont}
              />
            ))}
          </Section>
        ) : null}

        {/* Favorites */}
        {favoriteModels.length ? (
          <Section title="FAVORITES">
            {favoriteModels.map(m => (
              <ModelRow
                key={m} m={{id: m, provider: ''}} active={chatOptions.model === m}
                favorite={true}
                onApply={() => void apply(m)}
                onToggleFavorite={() => void toggleFavoriteModel(m)}
                monoFont={monoFont}
              />
            ))}
          </Section>
        ) : null}

        {/* Catalog */}
        <Section title="CATALOG">
          {catalog.map(m => (
            <ModelRow
              key={m.id} m={m} active={chatOptions.model === m.id}
              favorite={favoriteModels.includes(m.id)}
              onApply={() => void apply(m.id)}
              onToggleFavorite={() => void toggleFavoriteModel(m.id)}
              monoFont={monoFont}
            />
          ))}
        </Section>

        {/* Reasoning effort */}
        <Section title="REASONING EFFORT">
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, paddingHorizontal: spacing.lg, paddingBottom: 8, fontFamily: monoFont}]}>
            server currently: {reasoning || '(unknown)'}
          </Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: 6}}>
            {REASONING_OPTIONS.map(r => {
              const active = (chatOptions.reasoningEffort ?? 'medium') === r;
              return (
                <TouchableOpacity
                  key={r}
                  onPress={() => {
                    setChatOptions({...chatOptions, reasoningEffort: r as any});
                    void onSetReasoning(r);
                  }}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    borderWidth: 1,
                    borderColor: active ? palette.accent : palette.border,
                    backgroundColor: active ? palette.accentMuted ?? palette.surfaceAlt : 'transparent',
                  }}>
                  <Text style={[type.mono, {
                    color: active ? palette.accent : palette.textDim,
                    fontSize: 11, fontFamily: monoFont,
                  }]}>{r.toUpperCase()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Section>

        {/* Personality */}
        {personality ? (
          <Section title="PERSONALITY">
            <Text style={[type.body, {color: palette.text, fontSize: 13, paddingHorizontal: spacing.lg, fontFamily: monoFont}]}>
              {personality}
            </Text>
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}

const Section: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingTop: spacing.lg}}>
      <Text style={[type.label, {color: palette.textMuted, paddingHorizontal: spacing.lg, marginBottom: 6}]}>{title}</Text>
      {children}
    </View>
  );
};

const ModelRow: React.FC<{
  m: {id: string; provider: string};
  active: boolean;
  favorite: boolean;
  onApply: () => void;
  onToggleFavorite: () => void;
  monoFont?: any;
}> = ({m, active, favorite, onApply, onToggleFavorite, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <TouchableOpacity
      onPress={onApply}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
        backgroundColor: active ? (palette.accentMuted ?? 'transparent') : 'transparent',
      }}>
      <CpuIcon size={14} color={active ? palette.accent : palette.textDim} />
      <View style={{flex: 1, marginLeft: 10}}>
        <Text style={[type.body, {color: active ? palette.accent : palette.text, fontSize: 14}]} numberOfLines={1}>
          {m.id}
        </Text>
        {m.provider ? (
          <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginTop: 2, fontFamily: monoFont}]}>
            {m.provider}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity onPress={onToggleFavorite} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}} style={{padding: 6, marginRight: 4}}>
        {favorite
          ? <StarFilled size={14} color={palette.accent} filled />
          : <StarIcon size={14} color={palette.textDim} />}
      </TouchableOpacity>
      {active ? <CheckIcon size={14} color={palette.accent} /> : <ChevronRightIcon size={12} color={palette.textDim} />}
    </TouchableOpacity>
  );
};
