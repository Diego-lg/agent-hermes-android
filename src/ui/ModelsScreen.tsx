/**
 * ModelsScreen — provider-aware model picker.
 *
 * For each *enabled* provider, fetches its live model list via the public
 * `/v1/models` (or equivalent) endpoint and renders the resulting catalog
 * grouped by provider. Tapping a row applies the model id to the active
 * chat options and pushes it to the recents list.
 *
 * Disabled providers still appear in a compact row at the bottom so the
 * user can enable + configure them with one tap.
 *
 * On launch, the provider-configs map is auto-seeded from the legacy
 * single-provider Settings → AI key/baseUrl (see `buildSeedConfigs`).
 * If the user already set their MiniMax key there, MiniMax shows up
 * here with its live model list one refresh away.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, ScrollView, TextInput, TouchableOpacity, RefreshControl, Platform, Alert, Modal} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {StarIcon, StarFilled, RefreshIcon, CpuIcon, ChevronRightIcon, CheckIcon, ServerIcon, PlusIcon, XIcon, LockIcon, EyeIcon, EyeOffIcon, Volume2Icon, PlayIcon, StopIcon, SparklesIcon} from './icons';
import {PROVIDER_CATALOG, providerById, ProviderModel} from '../api/providersCatalog';
import type {ProviderConfig} from '../api/providerConfigsStore';
import {useVoice} from './useVoice';
import {SPEECH_MODELS, SYSTEM_VOICES, EMOTIONS} from '../api/minimaxVoice';

const REASONING_OPTIONS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

export default function ModelsScreen() {
  const {
    engine, engineClient, serverOnline,
    chatOptions, setChatOptions, patchChatOption,
    recentModels, favoriteModels, pushRecentModel, toggleFavoriteModel,
    providerConfigs, upsertProviderConfig, refreshProviderModels,
    refreshAllEnabledProviders, setActiveWorkspace, activeWorkspace,
  } = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [draft, setDraft] = useState(chatOptions.model ?? '');
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reasoning, setReasoning] = useState<string>('');
  const [personality, setPersonality] = useState<string>('');
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      if (engine?.id === 'desktop') {
        const active = await (engine as any).listActiveSessions?.();
        if (active && active[0]?.model) setCurrentModel(active[0].model);
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

  // On first mount, if any enabled provider has no fetched models yet,
  // trigger a background refresh. The user can also pull-to-refresh.
  useEffect(() => {
    const enabled = Object.values(providerConfigs).filter(c => c.enabled);
    if (enabled.some(c => !c.models || c.models.length === 0)) {
      void refreshAllEnabledProviders();
    }
    // We only want this to run once after the initial providerConfigs load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(providerConfigs).filter(k => providerConfigs[k]?.enabled).sort().join(',')]);

  const applyModel = useCallback(async (modelId: string) => {
    const trimmed = modelId.trim();
    if (!trimmed) return;
    setChatOptions({...chatOptions, model: trimmed, modelLabel: trimmed});
    await pushRecentModel(trimmed);
  }, [chatOptions, setChatOptions, pushRecentModel]);

  const setAuto = useCallback(() => {
    setChatOptions({...chatOptions, model: undefined, modelLabel: 'auto'});
  }, [chatOptions, setChatOptions]);

  const onSubmitDraft = () => { void applyModel(draft); };

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

  // Build the enabled-provider sections, then a compact list of disabled.
  const enabledProviders = useMemo(
    () => Object.values(providerConfigs).filter(c => c.enabled),
    [providerConfigs],
  );
  const disabledProviders = useMemo(
    () => Object.values(providerConfigs).filter(c => !c.enabled),
    [providerConfigs],
  );

  const enabledCount = enabledProviders.length;
  const totalModelCount = enabledProviders.reduce((s, c) => s + (c.models?.length ?? 0), 0);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <View style={{flex: 1}}>
          <Text style={[type.h2, {fontSize: 13, letterSpacing: 0.5}]}>MODELS</Text>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 9, marginTop: 2, fontFamily: monoFont}]}>
            {enabledCount} provider{enabledCount === 1 ? '' : 's'} · {totalModelCount} models
          </Text>
        </View>
        <TouchableOpacity onPress={() => void refreshAllEnabledProviders()} style={{padding: 6}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <RefreshIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowAddProvider(true)} style={{padding: 6, marginLeft: 4}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <PlusIcon size={16} color={palette.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refreshAllEnabledProviders()}
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
              placeholder="type any model id…"
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

        {/* MiniMax voice (TTS) config — speech model, voice, prosody */}
        <VoiceModelsSection monoFont={monoFont} />

        {/* Recents + Favorites */}
        {recentModels.length ? (
          <Section title="RECENTS">
            {recentModels.map(m => (
              <ModelRow
                key={`r-${m}`} m={{id: m}} active={chatOptions.model === m}
                favorite={favoriteModels.includes(m)}
                onApply={() => void applyModel(m)}
                onToggleFavorite={() => void toggleFavoriteModel(m)}
                monoFont={monoFont}
              />
            ))}
          </Section>
        ) : null}

        {favoriteModels.length ? (
          <Section title="FAVORITES">
            {favoriteModels.map(m => (
              <ModelRow
                key={`f-${m}`} m={{id: m}} active={chatOptions.model === m}
                favorite={true}
                onApply={() => void applyModel(m)}
                onToggleFavorite={() => void toggleFavoriteModel(m)}
                monoFont={monoFont}
              />
            ))}
          </Section>
        ) : null}

        {/* Per-provider sections */}
        {enabledProviders.length === 0 ? (
          <EmptyState
            title="NO PROVIDERS CONFIGURED"
            subtitle="Add a provider below to fetch its live model catalog."
          />
        ) : (
          enabledProviders.map(cfg => (
            <ProviderSection
              key={cfg.providerId}
              cfg={cfg}
              activeModel={chatOptions.model}
              favoriteModels={favoriteModels}
              onApply={m => void applyModel(m)}
              onToggleFavorite={m => void toggleFavoriteModel(m)}
              onRefresh={() => void refreshProviderModels(cfg.providerId)}
              onEdit={() => setEditingProvider(cfg.providerId)}
              monoFont={monoFont}
            />
          ))
        )}

        {/* Disabled providers — add more */}
        {disabledProviders.length > 0 ? (
          <Section title="ADD MORE PROVIDERS">
            {disabledProviders.map(cfg => (
              <DisabledProviderRow
                key={cfg.providerId}
                cfg={cfg}
                onEnable={() => setEditingProvider(cfg.providerId)}
                monoFont={monoFont}
              />
            ))}
          </Section>
        ) : null}

        {/* Reasoning effort */}
        <SectionHeader title="REASONING EFFORT" subtitle={`server: ${reasoning || '(unknown)'}`} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: 6, paddingBottom: 20}}>
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
                  backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                }}>
                <Text style={[type.mono, {
                  color: active ? palette.accent : palette.textDim,
                  fontSize: 11, fontFamily: monoFont,
                }]}>{r.toUpperCase()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Provider edit modal */}
      <ProviderEditModal
        providerId={editingProvider}
        onClose={() => setEditingProvider(null)}
        onSave={async (cfg, refreshAfter) => {
          await upsertProviderConfig(cfg);
          if (refreshAfter) {
            // Fire a refresh once the modal closes
            setTimeout(() => void refreshProviderModels(cfg.providerId), 50);
          }
          setEditingProvider(null);
        }}
      />

      {/* Add-provider sheet */}
      <AddProviderModal
        visible={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        onPick={providerId => {
          setShowAddProvider(false);
          setEditingProvider(providerId);
        }}
      />
    </View>
  );
}

/* ============================================================================
 * Provider section — shows the enabled provider's fetched model list with a
 * refresh button + an "edit" gear to reconfigure the API key.
 * ==========================================================================*/

const ProviderSection: React.FC<{
  cfg: ProviderConfig;
  activeModel: string | undefined;
  favoriteModels: string[];
  onApply: (m: string) => void;
  onToggleFavorite: (m: string) => void;
  onRefresh: () => void;
  onEdit: () => void;
  monoFont?: any;
}> = ({cfg, activeModel, favoriteModels, onApply, onToggleFavorite, onRefresh, onEdit, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  const def = providerById(cfg.providerId);
  const models = cfg.models ?? [];
  const fetched = !!cfg.fetchedAt;
  const error = cfg.lastError;

  return (
    <View style={{paddingTop: spacing.lg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, marginBottom: 6,
      }}>
        <Text style={[type.label, {color: palette.textMuted, flex: 1}]}>
          {def?.label ?? cfg.providerId.toUpperCase()}
        </Text>
        {fetched ? (
          <Text style={[type.mono, {color: palette.textDim, fontSize: 9, marginRight: 8, fontFamily: monoFont}]}>
            {models.length} models · {timeAgo(cfg.fetchedAt!)}
          </Text>
        ) : null}
        <TouchableOpacity onPress={onRefresh} hitSlop={{top:6, bottom:6, left:6, right:6}} style={{padding: 4, marginRight: 4}}>
          <RefreshIcon size={12} color={palette.textDim} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onEdit} hitSlop={{top:6, bottom:6, left:6, right:6}} style={{padding: 4}}>
          <Text style={[type.mono, {color: palette.accent, fontSize: 9, fontFamily: monoFont}]}>EDIT</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={{paddingHorizontal: spacing.lg, paddingBottom: 8}}>
          <Text style={[type.bodyMuted, {color: palette.error, fontSize: 11}]}>{error}</Text>
        </View>
      ) : null}

      {models.length === 0 && !error ? (
        <View style={{paddingHorizontal: spacing.lg, paddingVertical: 12}}>
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>
            Tap REFRESH to fetch models from {def?.label ?? cfg.providerId}.
          </Text>
        </View>
      ) : (
        models.map(m => (
          <ModelRow
            key={`${cfg.providerId}-${m.id}`}
            m={m}
            active={activeModel === m.id}
            favorite={favoriteModels.includes(m.id)}
            onApply={() => onApply(m.id)}
            onToggleFavorite={() => onToggleFavorite(m.id)}
            monoFont={monoFont}
          />
        ))
      )}
    </View>
  );
};

const DisabledProviderRow: React.FC<{
  cfg: ProviderConfig;
  onEnable: () => void;
  monoFont?: any;
}> = ({cfg, onEnable, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  const def = providerById(cfg.providerId);
  return (
    <TouchableOpacity
      onPress={onEnable}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
      <PlusIcon size={14} color={palette.accent} />
      <Text style={[type.body, {color: palette.text, fontSize: 13, marginLeft: 10, flex: 1}]}>
        {def?.label ?? cfg.providerId}
      </Text>
      <Text style={[type.mono, {color: palette.textDim, fontSize: 9, marginRight: 6, fontFamily: monoFont}]}>
        ADD
      </Text>
      <ChevronRightIcon size={12} color={palette.textDim} />
    </TouchableOpacity>
  );
};

/* ============================================================================
 * Provider edit modal — API key + base URL override + GroupId + enable toggle.
 * ==========================================================================*/

const ProviderEditModal: React.FC<{
  providerId: string | null;
  onClose: () => void;
  onSave: (cfg: Partial<ProviderConfig> & {providerId: string}, refresh: boolean) => void;
}> = ({providerId, onClose, onSave}) => {
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const {providerConfigs} = useApp();
  const def = providerId ? providerById(providerId) : null;
  const existing = providerId ? providerConfigs[providerId] : undefined;

  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [groupId, setGroupId] = useState(existing?.groupId ?? '');
  const [showKey, setShowKey] = useState(false);

  // Reset state when providerId changes
  useEffect(() => {
    setEnabled(existing?.enabled ?? false);
    setApiKey(existing?.apiKey ?? '');
    setBaseUrl(existing?.baseUrl ?? '');
    setGroupId(existing?.groupId ?? '');
    setShowKey(false);
  }, [providerId, existing?.enabled, existing?.apiKey, existing?.baseUrl, existing?.groupId]);

  if (!providerId || !def) return null;

  const needsKey = !!def.authHeader && def.id !== 'ollama' && def.id !== 'lmstudio';
  const needsGroup = def.needsGroupId;

  return (
    <Modal visible={!!providerId} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'}}>
        <View style={{
          backgroundColor: palette.bg,
          borderTopWidth: 1, borderColor: palette.border,
          padding: spacing.lg, maxHeight: '90%',
        }}>
          <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md}}>
            <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>
              {def.label.toUpperCase()}
            </Text>
            <TouchableOpacity onPress={onClose} style={{padding: 6}}>
              <XIcon size={18} color={palette.textDim} />
            </TouchableOpacity>
          </View>
          {def.description ? (
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginBottom: spacing.md}]}>
              {def.description}
            </Text>
          ) : null}

          <ScrollView keyboardShouldPersistTaps="handled">
            {/* Enable toggle */}
            <TouchableOpacity
              onPress={() => setEnabled(e => !e)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: palette.border,
              }}>
              <View style={{
                width: 18, height: 18, borderRadius: 4,
                borderWidth: 2,
                borderColor: enabled ? palette.accent : palette.border,
                backgroundColor: enabled ? palette.accent : 'transparent',
                alignItems: 'center', justifyContent: 'center',
                marginRight: 10,
              }}>
                {enabled ? <CheckIcon size={12} color={palette.bg} /> : null}
              </View>
              <Text style={[type.body, {color: palette.text, fontSize: 13, flex: 1}]}>Enabled</Text>
            </TouchableOpacity>

            {/* API Key */}
            {needsKey ? (
              <View style={{marginVertical: spacing.sm}}>
                <Text style={[type.label, {color: palette.textMuted, marginBottom: 4}]}>API KEY</Text>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                  <TextInput
                    value={apiKey}
                    onChangeText={setApiKey}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showKey}
                    placeholder={def.authHeader === 'x-api-key' ? 'sk-ant-…' : def.authHeader === 'x-goog-api-key' ? 'AIza…' : 'sk-…'}
                    placeholderTextColor={palette.textGhost}
                    style={{
                      flex: 1, color: palette.text, fontSize: 13,
                      fontFamily: monoFont,
                      paddingHorizontal: 10, paddingVertical: 10,
                      backgroundColor: palette.surfaceAlt,
                      borderWidth: 1, borderColor: palette.border,
                    }}
                  />
                  <TouchableOpacity onPress={() => setShowKey(s => !s)} style={{padding: 8}} hitSlop={{top:6, bottom:6, left:6, right:6}}>
                    {showKey ? <EyeOffIcon size={16} color={palette.textDim} /> : <EyeIcon size={16} color={palette.textDim} />}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={{marginVertical: spacing.sm}}>
                <Text style={[type.label, {color: palette.textMuted, marginBottom: 4}]}>API KEY</Text>
                <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11}]}>
                  Not required for {def.label}.
                </Text>
              </View>
            )}

            {/* Base URL override */}
            <View style={{marginVertical: spacing.sm}}>
              <Text style={[type.label, {color: palette.textMuted, marginBottom: 4}]}>BASE URL</Text>
              <TextInput
                value={baseUrl}
                onChangeText={setBaseUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={def.baseUrl}
                placeholderTextColor={palette.textGhost}
                style={{
                  color: palette.text, fontSize: 13, fontFamily: monoFont,
                  paddingHorizontal: 10, paddingVertical: 10,
                  backgroundColor: palette.surfaceAlt,
                  borderWidth: 1, borderColor: palette.border,
                }}
              />
              <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 9, marginTop: 4, fontFamily: monoFont}]}>
                default · {def.baseUrl || '(none)'}
              </Text>
            </View>

            {/* Group ID (MiniMax) */}
            {needsGroup ? (
              <View style={{marginVertical: spacing.sm}}>
                <Text style={[type.label, {color: palette.textMuted, marginBottom: 4}]}>GROUP ID</Text>
                <TextInput
                  value={groupId}
                  onChangeText={setGroupId}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="required for abab / M-series"
                  placeholderTextColor={palette.textGhost}
                  style={{
                    color: palette.text, fontSize: 13, fontFamily: monoFont,
                    paddingHorizontal: 10, paddingVertical: 10,
                    backgroundColor: palette.surfaceAlt,
                    borderWidth: 1, borderColor: palette.border,
                  }}
                />
              </View>
            ) : null}

            {/* Save button */}
            <TouchableOpacity
              onPress={() => {
                const trimmedKey = apiKey.trim();
                const trimmedBase = baseUrl.trim();
                const trimmedGroup = groupId.trim();
                const refresh = enabled && (
                  trimmedKey !== (existing?.apiKey ?? '') ||
                  trimmedBase !== (existing?.baseUrl ?? '') ||
                  trimmedGroup !== (existing?.groupId ?? '')
                );
                onSave({
                  providerId,
                  enabled,
                  apiKey: trimmedKey || undefined,
                  baseUrl: trimmedBase || undefined,
                  groupId: trimmedGroup || undefined,
                }, enabled && refresh);
              }}
              disabled={enabled && needsKey && !apiKey.trim()}
              style={{
                marginTop: spacing.md, paddingVertical: 14,
                alignItems: 'center',
                backgroundColor: (!enabled || (needsKey && !apiKey.trim()))
                  ? palette.surfaceAlt : palette.accent,
              }}>
              <Text style={{
                color: (!enabled || (needsKey && !apiKey.trim()))
                  ? palette.textDim : palette.bg,
                fontSize: 14, fontWeight: '600',
              }}>{existing?.enabled ? 'SAVE & REFRESH' : 'SAVE'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

/* ============================================================================
 * Add-provider sheet — pick a provider to configure from the catalog.
 * ==========================================================================*/

const AddProviderModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onPick: (providerId: string) => void;
}> = ({visible, onClose, onPick}) => {
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'}}>
        <View style={{
          backgroundColor: palette.bg,
          borderTopWidth: 1, borderColor: palette.border,
          maxHeight: '85%',
        }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 8,
            borderBottomWidth: 1, borderBottomColor: palette.border,
          }}>
            <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>ADD PROVIDER</Text>
            <TouchableOpacity onPress={onClose} style={{padding: 6}}>
              <XIcon size={18} color={palette.textDim} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom: 20}}>
            {PROVIDER_CATALOG.map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => onPick(p.id)}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingHorizontal: spacing.lg, paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: palette.border,
                }}>
                <CpuIcon size={16} color={palette.textDim} />
                <View style={{flex: 1, marginLeft: 10}}>
                  <Text style={[type.body, {color: palette.text, fontSize: 14}]}>
                    {p.label}
                  </Text>
                  <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginTop: 2, fontFamily: monoFont}]} numberOfLines={1}>
                    {p.baseUrl || '(no default url)'}
                  </Text>
                </View>
                <ChevronRightIcon size={12} color={palette.textDim} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

/* ============================================================================
 * Shared atoms
 * ==========================================================================*/

const Section: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingTop: spacing.lg}}>
      <Text style={[type.label, {color: palette.textMuted, paddingHorizontal: spacing.lg, marginBottom: 6}]}>{title}</Text>
      {children}
    </View>
  );
};

const SectionHeader: React.FC<{title: string; subtitle?: string}> = ({title, subtitle}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 4}}>
      <Text style={[type.label, {color: palette.textMuted}]}>{title}</Text>
      {subtitle ? (
        <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginTop: 2, fontFamily: 'monospace'}]}>{subtitle}</Text>
      ) : null}
    </View>
  );
};

const ModelRow: React.FC<{
  m: ProviderModel | {id: string};
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
        {(m as ProviderModel).ownedBy ? (
          <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginTop: 2, fontFamily: monoFont}]}>
            {(m as ProviderModel).ownedBy}
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

const EmptyState: React.FC<{title: string; subtitle: string}> = ({title, subtitle}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, alignItems: 'center'}}>
      <Text style={[type.label, {color: palette.textMuted}]}>{title}</Text>
      <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, marginTop: 8, textAlign: 'center'}]}>
        {subtitle}
      </Text>
    </View>
  );
};

function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* ============================================================================
 * VoiceModelsSection — MiniMax Text-to-Speech configuration.
 *
 * Speech (TTS) model + voice + prosody live here alongside the chat-model
 * picker, since they're part of "which MiniMax model is selected". Only
 * meaningful when a MiniMax key is configured; otherwise it shows a hint.
 * ==========================================================================*/

const VoiceModelsSection: React.FC<{monoFont?: any}> = ({monoFont}) => {
  const {palette, spacing, type} = useTheme();
  const voice = useVoice();
  const {settings, ready, patch, speak, stopSpeaking, speaking, audioAvailable, lastError,
    allVoices, voicesLoading, voicesError, refreshVoices} = voice;
  const [browserOpen, setBrowserOpen] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState('');

  const clampSpeed = (v: number) => Math.max(0.5, Math.min(2, Math.round(v * 10) / 10));

  const TOO_MANY = 14;
  const systemChips = useMemo(
    () => allVoices.filter(v => v.category === 'system' || v.category === 'generated'),
    [allVoices],
  );
  const filteredVoices = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase();
    if (!q) return systemChips;
    return systemChips.filter(v =>
      v.voiceId.toLowerCase().includes(q) ||
      v.name.toLowerCase().includes(q) ||
      (v.lang ?? '').toLowerCase().includes(q) ||
      (v.description ?? '').toLowerCase().includes(q));
  }, [systemChips, voiceQuery]);

  return (
    <View style={{paddingTop: spacing.lg}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: 6}}>
        <Volume2Icon size={13} color={palette.accent} />
        <Text style={[type.label, {color: palette.textMuted, marginLeft: 8, flex: 1}]}>VOICE · MINIMAX (TTS)</Text>
        {settings.useClonedVoice ? (
          <Text style={[type.mono, {color: palette.accent, fontSize: 9, fontFamily: monoFont}]}>CLONED</Text>
        ) : null}
      </View>

      {!ready ? (
        <View style={{paddingHorizontal: spacing.lg, paddingVertical: 12}}>
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>
            Add your MiniMax API key (Settings → AI, or enable the MiniMax provider above) to turn on text-to-voice and voice-to-voice.
          </Text>
        </View>
      ) : (
        <View style={{paddingHorizontal: spacing.lg}}>
          {/* Speech model */}
          <Text style={[type.label, {color: palette.textMuted, marginTop: 6, marginBottom: 6}]}>SPEECH MODEL</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
            {SPEECH_MODELS.map(m => {
              const active = settings.speechModel === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  onPress={() => patch('speechModel', m.id)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    borderWidth: 1,
                    borderColor: active ? palette.accent : palette.border,
                    backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                  }}>
                  <Text style={[type.mono, {color: active ? palette.accent : palette.textDim, fontSize: 11, fontFamily: monoFont}]}>
                    {m.id}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 10, marginTop: 4}]}>
            {SPEECH_MODELS.find(m => m.id === settings.speechModel)?.note}
          </Text>

          {/* Voice: header + fetch-all-voices */}
          <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6}}>
            <Text style={[type.label, {color: palette.textMuted, flex: 1}]}>VOICE</Text>
            <TouchableOpacity
              onPress={() => void refreshVoices()}
              disabled={voicesLoading}
              hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
              style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
              <RefreshIcon size={12} color={voicesLoading ? palette.textDim : palette.accent} />
              <Text style={[type.mono, {color: voicesLoading ? palette.textDim : palette.accent, fontSize: 9, fontFamily: monoFont}]}>
                {voicesLoading ? 'FETCHING…' : (systemChips.length ? `REFRESH (${systemChips.length})` : 'FETCH ALL VOICES')}
              </Text>
            </TouchableOpacity>
          </View>
          {voicesError ? (
            <Text style={[type.monoMuted, {color: palette.error, fontSize: 10, marginBottom: 6, fontFamily: monoFont}]}>{voicesError}</Text>
          ) : null}

          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
            {settings.clones.map(c => {
              const active = settings.voiceId === c.voiceId && settings.useClonedVoice;
              return (
                <TouchableOpacity
                  key={c.voiceId}
                  onPress={() => { patch('voiceId', c.voiceId); patch('useClonedVoice', true); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingHorizontal: 12, paddingVertical: 8,
                    borderWidth: 1,
                    borderColor: active ? palette.accent : palette.border,
                    backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                  }}>
                  <SparklesIcon size={11} color={active ? palette.accent : palette.highlight} />
                  <Text style={[type.mono, {color: active ? palette.accent : palette.textDim, fontSize: 11, fontFamily: monoFont}]}>
                    {c.label}
                  </Text>
                </TouchableOpacity>
              );
            })}

            {systemChips.length > TOO_MANY ? (
              <TouchableOpacity
                onPress={() => setBrowserOpen(true)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8,
                  borderWidth: 1, borderColor: palette.accent,
                  backgroundColor: palette.accentMuted ?? palette.surfaceAlt,
                }}>
                <Volume2Icon size={12} color={palette.accent} />
                <Text style={[type.mono, {color: palette.accent, fontSize: 11, fontFamily: monoFont}]}>
                  BROWSE ALL ({systemChips.length}) →
                </Text>
              </TouchableOpacity>
            ) : (
              (systemChips.length
                ? systemChips
                : SYSTEM_VOICES.map(v => ({voiceId: v.id, name: v.label, category: 'system' as const, description: undefined, lang: v.lang}))
              ).map(v => {
                const active = settings.voiceId === v.voiceId && !settings.useClonedVoice;
                return (
                  <TouchableOpacity
                    key={v.voiceId}
                    onPress={() => { patch('voiceId', v.voiceId); patch('useClonedVoice', false); }}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: active ? palette.accent : palette.border,
                      backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                    }}>
                    <Text style={[type.mono, {color: active ? palette.accent : palette.textDim, fontSize: 11, fontFamily: monoFont}]}>
                      {v.name}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
          {systemChips.length > TOO_MANY && !settings.useClonedVoice ? (
            <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginTop: 6, fontFamily: monoFont}]} numberOfLines={1}>
              selected: {settings.voiceId}
            </Text>
          ) : null}
          {!systemChips.length ? (
            <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, marginTop: 6, fontFamily: monoFont}]}>
              Showing a starter set — tap FETCH ALL VOICES to load the full MiniMax catalog (300+).
            </Text>
          ) : null}

          {/* Prosody: speed stepper + emotion chips */}
          <Text style={[type.label, {color: palette.textMuted, marginTop: 12, marginBottom: 6}]}>
            SPEED · {settings.speed.toFixed(1)}×
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
            <Stepper label="−" onPress={() => patch('speed', clampSpeed(settings.speed - 0.1))} monoFont={monoFont} />
            <View style={{flex: 1, height: 4, backgroundColor: palette.surfaceAlt, borderRadius: 2, overflow: 'hidden'}}>
              <View style={{width: `${((settings.speed - 0.5) / 1.5) * 100}%`, height: 4, backgroundColor: palette.accent}} />
            </View>
            <Stepper label="+" onPress={() => patch('speed', clampSpeed(settings.speed + 0.1))} monoFont={monoFont} />
          </View>

          <Text style={[type.label, {color: palette.textMuted, marginTop: 12, marginBottom: 6}]}>EMOTION</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
            {EMOTIONS.map(e => {
              const active = settings.emotion === e;
              return (
                <TouchableOpacity
                  key={e}
                  onPress={() => patch('emotion', e)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: active ? palette.accent : palette.border,
                    backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                  }}>
                  <Text style={[type.mono, {color: active ? palette.accent : palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                    {e.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Auto-speak toggle + preview */}
          <TouchableOpacity
            onPress={() => patch('autoSpeak', !settings.autoSpeak)}
            activeOpacity={0.7}
            style={{flexDirection: 'row', alignItems: 'center', marginTop: 14}}>
            <View style={{
              width: 18, height: 18, borderRadius: 4, borderWidth: 2, marginRight: 10,
              borderColor: settings.autoSpeak ? palette.accent : palette.border,
              backgroundColor: settings.autoSpeak ? palette.accent : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {settings.autoSpeak ? <CheckIcon size={12} color={palette.bg} /> : null}
            </View>
            <Text style={[type.body, {color: palette.text, fontSize: 13, flex: 1}]}>Speak replies automatically in Voice Mode</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => speaking ? void stopSpeaking() : void speak('This is a preview of the selected MiniMax voice.')}
            disabled={!audioAvailable}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 14, paddingVertical: 12,
              borderWidth: 1, borderColor: palette.border,
              backgroundColor: audioAvailable ? palette.surface : palette.bg,
              opacity: audioAvailable ? 1 : 0.5,
            }}>
            {speaking ? <StopIcon size={14} color={palette.error} filled /> : <PlayIcon size={14} color={palette.accent} />}
            <Text style={[type.h2, {color: palette.text, fontSize: 12, letterSpacing: 0.5}]}>
              {speaking ? 'STOP' : 'PREVIEW VOICE'}
            </Text>
          </TouchableOpacity>
          {!audioAvailable ? (
            <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, marginTop: 6, textAlign: 'center'}]}>
              Audio module not linked yet — run a native rebuild to enable playback.
            </Text>
          ) : null}
          {lastError ? (
            <Text style={[type.bodyMuted, {color: palette.error, fontSize: 11, marginTop: 6}]}>{lastError}</Text>
          ) : null}
        </View>
      )}

      {/* Full voice catalog — searchable popup (shown when there are many) */}
      <Modal visible={browserOpen} animationType="slide" transparent onRequestClose={() => setBrowserOpen(false)}>
        <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end'}}>
          <View style={{backgroundColor: palette.bg, borderTopWidth: 1, borderColor: palette.border, maxHeight: '85%', paddingTop: spacing.lg}}>
            <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.md}}>
              <Volume2Icon size={16} color={palette.accent} />
              <Text style={[type.h2, {flex: 1, marginLeft: 8, fontSize: 13, letterSpacing: 0.5}]}>
                ALL VOICES · {settings.speechModel}
              </Text>
              <TouchableOpacity onPress={() => setBrowserOpen(false)} style={{padding: 6}}>
                <XIcon size={18} color={palette.textDim} />
              </TouchableOpacity>
            </View>
            <View style={{paddingHorizontal: spacing.lg, marginBottom: spacing.sm}}>
              <TextInput
                value={voiceQuery}
                onChangeText={setVoiceQuery}
                placeholder={`Search ${systemChips.length} voices — name or language…`}
                placeholderTextColor={palette.textGhost}
                autoCorrect={false}
                style={{
                  color: palette.text, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12,
                  backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: palette.border,
                  fontFamily: monoFont,
                }}
              />
              <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, marginTop: 4, fontFamily: monoFont}]}>
                {filteredVoices.length} of {systemChips.length} · MiniMax system voices work across all speech models
              </Text>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" style={{paddingHorizontal: spacing.lg}} contentContainerStyle={{paddingBottom: 28}}>
              {filteredVoices.length === 0 ? (
                <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, paddingVertical: 16, textAlign: 'center'}]}>
                  No voices match “{voiceQuery}”.
                </Text>
              ) : filteredVoices.map(v => {
                const active = settings.voiceId === v.voiceId && !settings.useClonedVoice;
                return (
                  <TouchableOpacity
                    key={v.voiceId}
                    onPress={() => { patch('voiceId', v.voiceId); patch('useClonedVoice', false); setBrowserOpen(false); }}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border,
                    }}>
                    <View style={{flex: 1, paddingRight: 10}}>
                      <Text style={[type.body, {color: active ? palette.accent : palette.text, fontSize: 13}]}>
                        {v.name}
                        {v.lang ? <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10}]}>{'  · ' + v.lang}</Text> : null}
                        {v.category === 'generated' ? <Text style={[type.monoMuted, {color: palette.highlight, fontSize: 10}]}>{'  · designed'}</Text> : null}
                      </Text>
                      <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, marginTop: 2, fontFamily: monoFont}]} numberOfLines={1}>
                        {v.voiceId}
                      </Text>
                      {v.description ? (
                        <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginTop: 2}]} numberOfLines={2}>
                          {v.description}
                        </Text>
                      ) : null}
                    </View>
                    {active ? <CheckIcon size={14} color={palette.accent} /> : <ChevronRightIcon size={14} color={palette.textDim} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const Stepper: React.FC<{label: string; onPress: () => void; monoFont?: any}> = ({label, onPress, monoFont}) => {
  const {palette} = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: 36, height: 32, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceAlt,
      }}>
      <Text style={{color: palette.text, fontSize: 18, fontFamily: monoFont, lineHeight: 20}}>{label}</Text>
    </TouchableOpacity>
  );
};
