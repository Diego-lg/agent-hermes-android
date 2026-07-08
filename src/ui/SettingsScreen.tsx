/**
 * Settings tab. Theme-aware. Now includes an Appearance section for picking
 * one of the 6 design systems (Industrial, Brutalist, Soft Glass, Editorial,
 * Neon, Warm Clay).
 */
import React, {useEffect, useState} from 'react';
import {View, ScrollView, TouchableOpacity, Text, TextInput, Alert, Animated} from 'react-native';
import {useApp} from './AppContext';
import {Field} from './atoms';
import {useTheme, THEME_LIST, Theme, ThemeId} from './theme.tsx';
import {useThemeController} from './ThemeController';
import {AGENT_CATALOG} from '../agents/catalog';
import {ChevronRightIcon, EyeIcon, EyeOffIcon, CheckIcon, InfoIcon, RefreshIcon, ZapIcon, CpuIcon, ServerIcon} from './icons';
import {notesStore} from '../api/notesStore';
import {DriveConfig} from '../api/googleDrive';

export default function SettingsScreen() {
  const {config, setConfig, engine, engineClient, engineLabel, serverOnline, connect, disconnect, logout, setScreen, switchEngine} = useApp();
  const {palette, spacing, type, radii} = useTheme();
  const [editing, setEditing] = useState(false);
  // Seed draft from the live config when the editing form is closed, so
  // opening it picks up the freshly-loaded config but a user's in-progress
  // edits aren't clobbered when setConfig updates `config`.
  const [draft, setDraft] = useState(config);
  useEffect(() => { if (!editing) setDraft(config); }, [config, editing]);
  const [showPwd, setShowPwd] = useState(false);
  // AI engine section: a single editing pane for model key/base/model + mode toggle.
  const [aiEditing, setAiEditing] = useState(false);
  const [aiDraft, setAiDraft] = useState({
    modelApiKey: config.modelApiKey ?? '',
    modelBaseUrl: config.modelBaseUrl ?? 'https://api.minimax.io/v1',
    modelId: config.modelId ?? 'MiniMax-Text-01',
    modelGroupId: config.modelGroupId ?? '',
  });
  useEffect(() => {
    if (!aiEditing) {
      setAiDraft({
        modelApiKey: config.modelApiKey ?? '',
        modelBaseUrl: config.modelBaseUrl ?? 'https://api.minimax.io/v1',
        modelId: config.modelId ?? 'MiniMax-Text-01',
        modelGroupId: config.modelGroupId ?? '',
      });
    }
  }, [config, aiEditing]);
  const [showApiKey, setShowApiKey] = useState(false);
  // "Fetch models" UI: hold the list, track loading/error, remember
  // which source the current list came from so the inline UI can show
  // the right source label and the RETRY button knows which fetch to
  // re-trigger.
  const [models, setModels] = useState<{id: string; tag?: string; source?: 'desktop' | 'cloud'}[] | null>(null);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  // Which engine the picker is currently querying. 'cloud' → {baseUrl}/models
  // with the configured key+GroupId. 'desktop' → engineClient.listModels().
  const [modelsSource, setModelsSource] = useState<'cloud' | 'desktop'>('cloud');
  const [signingOut, setSigningOut] = useState(false);
  const [slideX] = useState(new Animated.Value(0));
  const [drive, setDrive] = useState<DriveConfig | null>(null);
  const [driveEmail, setDriveEmail] = useState<string | null>(null);
  const [draftClientId, setDraftClientId] = useState('');

  const {themeId, setTheme} = useThemeController();

  useEffect(() => {
    (async () => {
      const cfg = await notesStore.loadConfig();
      setDrive(cfg);
      if (notesStore.isAuthorized()) {
        try {
          const me = await notesStore.me();
          setDriveEmail(me.email);
        } catch { /* token may be expired */ }
      }
    })();
  }, []);

  const onSave = async () => {
    setConfig(draft);
    setEditing(false);
    if (engine) disconnect();
    await connect();
  };

  const onSaveAi = async () => {
    const next = {
      ...config,
      modelApiKey: aiDraft.modelApiKey.trim(),
      modelBaseUrl: aiDraft.modelBaseUrl.trim() || 'https://api.minimax.io/v1',
      modelId: aiDraft.modelId.trim() || 'MiniMax-Text-01',
      modelGroupId: aiDraft.modelGroupId.trim(),
    };
    setConfig(next);
    setAiEditing(false);
    if (engine) disconnect();
    await connect();
  };

  const onPickMode = (mode: 'auto' | 'desktop' | 'minimax') => {
    if ((config.engineMode ?? 'auto') === mode) return;
    Alert.alert(
      'Switch engine',
      `Pin to ${mode === 'auto' ? 'Auto (probe desktop, fall back to cloud)' : mode === 'desktop' ? 'Desktop server only' : 'Mobile cloud only'}? Reconnect now?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Switch', onPress: () => { void switchEngine(mode); }},
      ],
    );
  };

  /** Best-effort label for a model id — "fast", "pro", or undefined.
   *  Helps the picker show what to expect. Conservative: only fires on
   *  unambiguous substrings. */
  const modelTag = (id: string): string | undefined => {
    const l = id.toLowerCase();
    if (/(highspeed|fast|turbo|nano|mini|haiku|lite|flash)/.test(l)) return 'fast';
    if (/(pro|opus|reasoning|thinking|expert|plus|max|xlarge)/.test(l)) return 'pro';
    return undefined;
  };

  /** Hit {baseUrl}/models with the configured key, parse the response,
   /** Hit {baseUrl}/models with the configured key, parse the response,
   *  and open the picker. Tolerates the two common shapes:
   *    - OpenAI-compatible: { data: [{id, ...}, ...] }
   *    - Anthropic-style:   { data: [{id, display_name, type}, ...] }
   *    - Flat:              [{id, name}, ...]
   *  Sorts fast-tier first, then pro, then the rest.
   *
   *  The provider we default to (api.minimax.io) accepts OpenAI-style
   *  auth but some model series also need a `GroupId` header — without
   *  it the API returns 401 with the message "invalid API key". So we
   *  pass GroupId when set, and on a 401 we retry with `api-key: ***`
   *  (Anthropic style) before giving up. */
  const fetchCloudModels = async () => {
    setModelsSource('cloud');
    setModels(null);
    setModelsErr(null);
    setModelsLoading(true);
    try {
      const baseUrl = (config.modelBaseUrl?.trim() || 'https://api.minimax.io/v1').replace(/\/+$/, '');
      const key = config.modelApiKey?.trim();
      if (!key) {
        setModelsErr('Add a model API key first.');
        setModelsLoading(false);
        return;
      }
      const url = `${baseUrl}/models`;
      const groupId = config.modelGroupId?.trim();
      const buildHeaders = (variant: 'bearer' | 'apikey') => {
        const h: Record<string, string> = {};
        if (variant === 'bearer') h.Authorization = 'Bearer ' + key;
        else h['api-key'] = key;
        if (groupId) h.GroupId = groupId;
        return h;
      };
      const keyPreview = `${key.slice(0, 4)}…${key.slice(-2)} (len ${key.length})`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let r = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: buildHeaders('bearer'),
      });
      if (!r.ok && (r.status === 401 || r.status === 403)) {
        r = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: buildHeaders('apikey'),
        });
      }
      clearTimeout(timeout);
      if (!r.ok) {
        const body = (await r.text()).slice(0, 240);
        setModelsErr(
          `HTTP ${r.status} for ${url}\n` +
          `key sent: ${keyPreview}` +
          (groupId ? `\nGroupId sent: ${groupId.slice(0, 4)}…${groupId.slice(-2)} (len ${groupId.length})` : '\nGroupId: (not set — provider may require it for some model series)') +
          `\n\nServer says: ${body || '(no body)'}\n\n` +
          `If the key is right, double-check the GroupId in Settings → AI, or copy the key from the provider's dashboard again.`,
        );
        setModelsLoading(false);
        return;
      }
      const j: any = await r.json();
      let raw: any[] = [];
      if (Array.isArray(j?.data)) raw = j.data;
      else if (Array.isArray(j?.models)) raw = j.models;
      else if (Array.isArray(j)) raw = j;
      const seen = new Set<string>();
      const parsed: {id: string; tag?: string; source: 'cloud'}[] = [];
      for (const m of raw) {
        const id: string | undefined = m?.id ?? m?.name ?? m?.model;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        parsed.push({id, tag: modelTag(id), source: 'cloud'});
      }
      if (parsed.length === 0) {
        setModelsErr(
          `Endpoint returned no models (key sent: ${keyPreview}).\n` +
          `Got ${typeof j === 'object' ? `object with ${Object.keys(j).length} keys` : 'non-object'}; expected { data: [...] } or [...].`,
        );
        setModelsLoading(false);
        return;
      }
      const rank = (t?: string) => (t === 'fast' ? 0 : t === 'pro' ? 1 : 2);
      parsed.sort((a, b) => {
        const r = rank(a.tag) - rank(b.tag);
        if (r !== 0) return r;
        return a.id.localeCompare(b.id);
      });
      setModels(parsed);
    } catch (e: any) {
      setModelsErr(e?.name === 'AbortError' ? 'Request timed out (8s).' : (e?.message ?? String(e)));
    } finally {
      setModelsLoading(false);
    }
  };



  /** Fetch the list of models the desktop server knows about. Goes through
   *  the engineClient (JSON-RPC model.list) so we pick from the same
   *  catalog the desktop itself is configured with. Empty list means the
   *  server doesn't implement model.list (older versions). */
  const fetchDesktopModels = async () => {
    setModelsSource('desktop');
    setModels(null);
    setModelsErr(null);
    setModelsLoading(true);
    try {
      if (!engineClient) {
        setModelsErr('No desktop engine connected. Connect to the PC server first (long-press the engine pill on Home).');
        setModelsLoading(false);
        return;
      }
      const raw = await engineClient.listModels();
      const seen = new Set<string>();
      const parsed: {id: string; tag?: string; source: 'desktop'}[] = [];
      for (const m of raw) {
        const id: string | undefined = m?.id ?? m?.name ?? m?.model;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        parsed.push({id, tag: modelTag(id), source: 'desktop'});
      }
      if (parsed.length === 0) {
        setModelsErr(
          `Desktop server returned no models (or doesn't implement model.list yet).\n` +
          `Engine: ${engineClient ? 'connected' : 'not connected'}\n` +
          `Make sure you're on the desktop engine (long-press the engine pill in Home) and that the server version supports model.list.`,
        );
        setModelsLoading(false);
        return;
      }
      const rank = (t?: string) => (t === 'fast' ? 0 : t === 'pro' ? 1 : 2);
      parsed.sort((a, b) => {
        const r = rank(a.tag) - rank(b.tag);
        if (r !== 0) return r;
        return a.id.localeCompare(b.id);
      });
      setModels(parsed);
    } catch (e: any) {
      setModelsErr(e?.message ?? String(e));
    } finally {
      setModelsLoading(false);
    }
  };
  const onPickModel = (id: string) => {
    // If we're currently editing the AI pane, write straight into the draft.
    if (aiEditing) setAiDraft(d => ({...d, modelId: id}));
    else setConfig({...config, modelId: id});
  };

  const onSignOut = () => {
    setSigningOut(true);
    Animated.timing(slideX, {toValue: 1, duration: 1500, useNativeDriver: false}).start(({finished}) => {
      if (finished) { setSigningOut(false); slideX.setValue(0); void logout(); }
    });
  };

  const onConnectDrive = async () => {
    if (!drive) { Alert.alert('Setup needed', 'Add your Google OAuth Client ID first.'); return; }
    setDriveEmail('connecting…');
    try {
      await notesStore.authorize();
      const me = await notesStore.me();
      setDriveEmail(me.email);
    } catch (e: any) {
      setDriveEmail(null);
      Alert.alert('Drive sign-in failed', e?.message ?? String(e));
    }
  };

  const onSaveClientId = async () => {
    if (!draftClientId.trim()) {
      Alert.alert('Client ID needed', 'Paste the Google OAuth Client ID from your Google Cloud Console.');
      return;
    }
    const newCfg: DriveConfig = {
      clientId: draftClientId.trim(),
      redirectUrl: 'com.diego.androidhermes:/oauth',
    };
    await notesStore.saveConfig(newCfg);
    setDrive(newCfg);
    setDraftClientId('');
  };

  const onDisconnectDrive = async () => {
    try { await notesStore.signOut(); setDriveEmail(null); } catch {}
  };

  const Section: React.FC<{index: string; title: string; children: React.ReactNode}> = ({index, title, children}) => (
    <View style={{marginBottom: spacing.xl}}>
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm}}>
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10}]}>{index}</Text>
        <View style={{width: 1, height: 12, backgroundColor: palette.border, marginHorizontal: spacing.sm}} />
        <Text style={type.label}>{title}</Text>
      </View>
      <View>{children}</View>
    </View>
  );

  const Row: React.FC<{
    index: string; label: string; value?: string; onPress?: () => void;
    destructive?: boolean; right?: React.ReactNode; last?: boolean;
  }> = ({index, label, value, onPress, destructive, right, last}) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 14,
        borderTopWidth: last ? 0 : 1, borderTopColor: palette.border,
      }}>
      <Text style={[type.mono, {width: 32, color: palette.textDim, fontSize: 11}]}>{index}</Text>
      <Text style={[type.body, {flex: 1, color: destructive ? palette.error : palette.text}]}>{label}</Text>
      {value ? (
        <Text style={[type.monoMuted, {fontSize: 11, color: palette.textMuted, marginRight: 6}]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <ChevronRightIcon size={16} color={palette.textDim} /> : null)}
    </TouchableOpacity>
  );

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: palette.bg}}
      contentContainerStyle={{paddingBottom: 40}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <Text style={type.label}>SETTINGS</Text>
        <Text style={[type.displaySmall, {marginTop: spacing.sm}]}>Configuration</Text>
        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.xl}} />

        {/* ----- 01 APPEARANCE — theme picker ----- */}
        <Section index="01" title="APPEARANCE">
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs}}>
            {THEME_LIST.map(t => (
              <ThemeCard
                key={t.id}
                theme={t}
                active={t.id === themeId}
                onPress={() => setTheme(t.id as ThemeId)}
              />
            ))}
          </View>
        </Section>

        <Section index="02" title="CONNECTION">
          <Row index="00" label="Server" value={`${config.host}:${config.port}`}
            onPress={() => { setDraft(config); setEditing(true); }} />
          <Row index="01" label="User" value={config.username}
            onPress={() => { setDraft(config); setEditing(true); }} last />
        </Section>

        {editing ? (
          <View style={{
            backgroundColor: palette.surface,
            borderWidth: 1, borderColor: palette.border,
            padding: spacing.lg, marginBottom: spacing.xl,
          }}>
            <Text style={[type.label, {marginBottom: spacing.md}]}>EDIT CONNECTION</Text>
            <Field label="Host" value={draft.host} onChangeText={v => setDraft({...draft, host: v})} autoCapitalize="none" />
            <Field label="Port" value={String(draft.port)} onChangeText={v => setDraft({...draft, port: parseInt(v, 10) || 9119})} keyboardType="number-pad" />
            <Field label="Username" value={draft.username} onChangeText={v => setDraft({...draft, username: v})} autoCapitalize="none" />
            <View style={{position: 'relative'}}>
              <Field label="Password" value={draft.password} onChangeText={v => setDraft({...draft, password: v})} secureTextEntry={!showPwd} autoCapitalize="none" />
              <TouchableOpacity onPress={() => setShowPwd(s => !s)} style={{position: 'absolute', right: 0, top: 28, padding: 8}}>
                {showPwd ? <EyeOffIcon size={16} color={palette.textMuted} /> : <EyeIcon size={16} color={palette.textMuted} />}
              </TouchableOpacity>
            </View>
            <View style={{flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md}}>
              <TouchableOpacity onPress={onSave} style={{flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: palette.accent}}>
                <Text style={[type.h2, {color: palette.bg, fontSize: 12, letterSpacing: 0.5}]}>SAVE & CONNECT</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setEditing(false); setDraft(config); }} style={{flex: 1, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: palette.border}}>
                <Text style={[type.h2, {color: palette.text, fontSize: 12, letterSpacing: 0.5}]}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* ----- 03 AI ENGINE — model API key, model id, base URL, mode toggle ----- */}
        <Section index="03" title="AI ENGINE">
          {/* Engine status line — mirrors the pill in the HomeScreen header. */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingVertical: 12,
            borderTopWidth: 0,
          }}>
            <Text style={[type.mono, {width: 32, color: palette.textDim, fontSize: 11}]}>00</Text>
            <View style={{flex: 1}}>
              <Text style={[type.body, {color: palette.text}]}>Active engine</Text>
              <Text style={[type.monoMuted, {fontSize: 10, color: palette.textMuted, marginTop: 2}]}>
                {engineLabel}{serverOnline ? `  ·  ${config.host}` : ''}
              </Text>
            </View>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: serverOnline ? palette.success : (engine ? palette.textDim : palette.error),
            }} />
          </View>

          {/* Mode toggle: auto / desktop / cloud (three pills) */}
          <View style={{paddingTop: 4}}>
            <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>MODE</Text>
            <View style={{flexDirection: 'row', gap: spacing.sm}}>
              {([
                {id: 'auto',     label: 'AUTO',     sub: 'probe desktop · fall back to cloud'},
                {id: 'desktop',  label: 'DESKTOP',  sub: 'server pinned — no fallback'},
                {id: 'minimax',  label: 'MOBILE',   sub: 'cloud only — no PC tools'},
              ] as const).map(m => {
                const active = (config.engineMode ?? 'auto') === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => onPickMode(m.id)}
                    activeOpacity={0.7}
                    style={{
                      flex: 1,
                      paddingVertical: 10, paddingHorizontal: 8,
                      borderWidth: 1,
                      borderColor: active ? palette.accent : palette.border,
                      backgroundColor: active ? palette.accentMuted : 'transparent',
                    }}>
                    <Text style={[type.h2, {
                      fontSize: 11,
                      color: active ? palette.accent : palette.textMuted,
                      letterSpacing: 0.6,
                    }]}>
                      {m.label}
                    </Text>
                    <Text style={[type.monoMuted, {
                      fontSize: 9, marginTop: 4,
                      color: active ? palette.text : palette.textDim,
                    }]} numberOfLines={2}>
                      {m.sub}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Key/URL/Model rows — the rows for key / base URL / GroupId
              still open the editor (secrets & URLs need text input). The
              Model id row is a read-only summary that highlights the
              active selection — to change it, use the inline picker
              below. */}
          <View style={{marginTop: spacing.md}}>
            <Row index="01" label="Model API key"
              value={config.modelApiKey ? `${config.modelApiKey.slice(0, 4)}…${config.modelApiKey.slice(-2)}` : 'NOT SET'}
              onPress={() => { setAiDraft({
                modelApiKey: config.modelApiKey ?? '',
                modelBaseUrl: config.modelBaseUrl ?? 'https://api.minimax.io/v1',
                modelId: config.modelId ?? 'MiniMax-Text-01',
                modelGroupId: config.modelGroupId ?? '',
              }); setAiEditing(true); }} />
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: 14,
              borderTopWidth: 1, borderTopColor: palette.border,
            }}>
              <Text style={[type.mono, {width: 32, color: palette.textDim, fontSize: 11}]}>02</Text>
              <Text style={[type.body, {flex: 1, color: palette.text}]}>Model id</Text>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                <Text style={[type.mono, {color: palette.textMuted, fontSize: 11}]} numberOfLines={1}>
                  {config.modelId ?? 'MiniMax-Text-01'}
                </Text>
                {(config.modelId ?? 'MiniMax-Text-01') === (aiEditing ? aiDraft.modelId : config.modelId) ? (
                  <View style={{
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: palette.success,
                  }} />
                ) : null}
              </View>
            </View>
            <Row index="03" label="Base URL" value={config.modelBaseUrl ?? 'https://api.minimax.io/v1'}
              onPress={() => { setAiDraft({
                modelApiKey: config.modelApiKey ?? '',
                modelBaseUrl: config.modelBaseUrl ?? 'https://api.minimax.io/v1',
                modelId: config.modelId ?? 'MiniMax-Text-01',
                modelGroupId: config.modelGroupId ?? '',
              }); setAiEditing(true); }} />
            <Row index="04" label="GroupId" value={config.modelGroupId ? `${config.modelGroupId.slice(0, 4)}…${config.modelGroupId.slice(-2)}` : 'NOT SET'}
              onPress={() => { setAiDraft({
                modelApiKey: config.modelApiKey ?? '',
                modelBaseUrl: config.modelBaseUrl ?? 'https://api.minimax.io/v1',
                modelId: config.modelId ?? 'MiniMax-Text-01',
                modelGroupId: config.modelGroupId ?? '',
              }); setAiEditing(true); }} last />
          </View>

          {/* ----- INLINE MODEL PICKER (the new "show a list" UI) -----
              Replaces the old "tap Model id row to edit a text field"
              flow. Two sources (CLOUD / PC SERVER) and a scrollable
              list of available models. Tap any row to make it the
              active model. */}
          <View style={{marginTop: spacing.lg}}>
            <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>
              MODELS  ·  PICK FROM LIST
            </Text>

            <View style={{flexDirection: 'row', gap: spacing.sm}}>
              <TouchableOpacity
                onPress={fetchCloudModels}
                disabled={modelsLoading}
                style={{
                  flex: 1,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 10,
                  borderWidth: 1, borderColor: palette.border,
                  backgroundColor: palette.surface,
                }}>
                <RefreshIcon size={12} color={palette.text} />
                <Text style={[type.h2, {color: palette.text, fontSize: 11, letterSpacing: 0.5}]}>
                  LOAD CLOUD
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={fetchDesktopModels}
                disabled={modelsLoading || !engineClient}
                style={{
                  flex: 1,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 10,
                  borderWidth: 1, borderColor: palette.border,
                  backgroundColor: engineClient ? palette.surface : palette.bg,
                  opacity: engineClient ? 1 : 0.4,
                }}>
                <ServerIcon size={12} color={palette.text} />
                <Text style={[type.h2, {color: palette.text, fontSize: 11, letterSpacing: 0.5}]}>
                  LOAD PC
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, marginTop: 4, textAlign: 'center'}]}>
              {engineClient
                ? 'Cloud: provider /models  ·  PC: model.list over engineClient'
                : 'PC is disabled — long-press the engine pill on Home to connect a desktop first'}
            </Text>

            {/* The list itself. Shows inline once models are loaded.
                Empty / loading / error states get a short hint box. */}
            <View style={{marginTop: spacing.md, borderWidth: 1, borderColor: palette.border}}>
              {modelsLoading ? (
                <View style={{padding: spacing.lg, alignItems: 'center'}}>
                  <Text style={[type.body, {color: palette.textMuted}]}>
                    {modelsSource === 'desktop' ? 'Fetching from PC server…' : 'Fetching from provider…'}
                  </Text>
                </View>
              ) : modelsErr ? (
                <View style={{padding: spacing.md}}>
                  <Text style={[type.label, {color: palette.error, marginBottom: 4}]}>FETCH FAILED</Text>
                  <Text style={[type.monoMuted, {color: palette.textMuted, fontSize: 11, lineHeight: 16}]}>
                    {modelsErr}
                  </Text>
                  <TouchableOpacity
                    onPress={modelsSource === 'desktop' ? fetchDesktopModels : fetchCloudModels}
                    style={{marginTop: 10, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.border}}>
                    <Text style={[type.h2, {color: palette.text, fontSize: 11, letterSpacing: 0.5}]}>RETRY</Text>
                  </TouchableOpacity>
                </View>
              ) : models && models.length > 0 ? (
                <ScrollView style={{maxHeight: 320}} keyboardShouldPersistTaps="handled">
                  <View style={{paddingHorizontal: spacing.sm, paddingVertical: 4}}>
                    <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, paddingVertical: 4}]}>
                      {modelsSource === 'desktop'
                        ? `PC server (${config.host})  ·  ${models.length} models`
                        : `${config.modelBaseUrl?.trim() || 'https://api.minimax.io/v1'}  ·  ${models.length} models`}
                    </Text>
                  </View>
                  {models.map((m, idx) => {
                    const isCurrent = (aiEditing ? aiDraft.modelId : config.modelId) === m.id;
                    return (
                      <TouchableOpacity
                        key={`${m.source ?? 'x'}-${m.id}-${idx}`}
                        onPress={() => onPickModel(m.id)}
                        activeOpacity={0.6}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          paddingVertical: 10, paddingHorizontal: spacing.sm,
                          borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: palette.border,
                          backgroundColor: isCurrent ? palette.accentMuted : 'transparent',
                        }}>
                        <Text style={[type.mono, {width: 28, color: palette.textDim, fontSize: 10}]}>
                          {String(idx).padStart(2, '0')}
                        </Text>
                        <View style={{flex: 1}}>
                          <Text style={[type.body, {color: palette.text, fontFamily: type.mono.fontFamily}]} numberOfLines={1}>
                            {m.id}
                          </Text>
                        </View>
                        {m.source === 'desktop' ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 6}}>
                            <ServerIcon size={11} color={palette.textMuted} />
                            <Text style={[type.mono, {color: palette.textMuted, fontSize: 9, letterSpacing: 0.4}]}>PC</Text>
                          </View>
                        ) : m.source === 'cloud' ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 6}}>
                            <RefreshIcon size={11} color={palette.textMuted} />
                            <Text style={[type.mono, {color: palette.textMuted, fontSize: 9, letterSpacing: 0.4}]}>CLOUD</Text>
                          </View>
                        ) : null}
                        {m.tag === 'fast' ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 6}}>
                            <ZapIcon size={11} color={palette.success} />
                            <Text style={[type.mono, {color: palette.success, fontSize: 9, letterSpacing: 0.4}]}>FAST</Text>
                          </View>
                        ) : m.tag === 'pro' ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 6}}>
                            <CpuIcon size={11} color={palette.highlight} />
                            <Text style={[type.mono, {color: palette.highlight, fontSize: 9, letterSpacing: 0.4}]}>PRO</Text>
                          </View>
                        ) : null}
                        {isCurrent ? <CheckIcon size={14} color={palette.accent} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={{padding: spacing.lg, alignItems: 'center'}}>
                  <Text style={[type.body, {color: palette.textMuted, textAlign: 'center', fontSize: 12}]}>
                    No models loaded yet.{'\n'}Tap LOAD CLOUD or LOAD PC above.
                  </Text>
                </View>
              )}
            </View>
          </View>

          {!config.modelApiKey ? (
            <View style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 8,
              marginTop: spacing.md, padding: spacing.sm,
              backgroundColor: palette.surface,
              borderWidth: 1, borderColor: palette.border,
            }}>
              <View style={{marginTop: 2}}><InfoIcon size={12} color={palette.textMuted} /></View>
              <Text style={[type.monoMuted, {flex: 1, color: palette.textMuted, fontSize: 10, lineHeight: 15}]}>
                No model API key set. Mobile mode needs a key to talk to the model provider. With Auto mode and a desktop server, the phone will fall back to the desktop and ignore this.
              </Text>
            </View>
          ) : null}
        </Section>

        {aiEditing ? (
          <View style={{
            backgroundColor: palette.surface,
            borderWidth: 1, borderColor: palette.border,
            padding: spacing.lg, marginBottom: spacing.xl,
          }}>
            <Text style={[type.label, {marginBottom: spacing.md}]}>EDIT AI ENGINE</Text>
            <View style={{position: 'relative'}}>
              <Field label="Model API key" value={aiDraft.modelApiKey} onChangeText={v => setAiDraft({...aiDraft, modelApiKey: v})} secureTextEntry={!showApiKey} autoCapitalize="none" />
              <TouchableOpacity onPress={() => setShowApiKey(s => !s)} style={{position: 'absolute', right: 0, top: 28, padding: 8}}>
                {showApiKey ? <EyeOffIcon size={16} color={palette.textMuted} /> : <EyeIcon size={16} color={palette.textMuted} />}
              </TouchableOpacity>
            </View>
            <Field label="Base URL" value={aiDraft.modelBaseUrl} onChangeText={v => setAiDraft({...aiDraft, modelBaseUrl: v})} autoCapitalize="none" />
            <Field label="Model id" value={aiDraft.modelId} onChangeText={v => setAiDraft({...aiDraft, modelId: v})} autoCapitalize="none" />
            <Field label="GroupId (some providers require it)" value={aiDraft.modelGroupId} onChangeText={v => setAiDraft({...aiDraft, modelGroupId: v})} autoCapitalize="none" />
            <View style={{flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md}}>
              <TouchableOpacity onPress={onSaveAi} style={{flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: palette.accent}}>
                <Text style={[type.h2, {color: palette.bg, fontSize: 12, letterSpacing: 0.5}]}>SAVE & RECONNECT</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAiEditing(false)} style={{flex: 1, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: palette.border}}>
                <Text style={[type.h2, {color: palette.text, fontSize: 12, letterSpacing: 0.5}]}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* The picker is now inline (see "MODELS · PICK FROM LIST" above).
            The previous bottom-sheet modal is removed — the inline UI is
            the primary way to fetch + pick models. */}

        <Section index="04" title="CLOUD — GOOGLE DRIVE">
          <Row index="00" label="Status" value={driveEmail ?? (drive ? 'NOT SIGNED IN' : 'NOT CONFIGURED')} />
          <Row index="01" label={drive ? 'OAuth Client ID' : 'Set Client ID'}
            value={drive ? `${drive.clientId.slice(0, 14)}…` : 'tap to add'}
            onPress={() => Alert.alert(
              'OAuth Client ID',
              'Open console.cloud.google.com, create an Android OAuth Client, paste its Client ID below.',
              [{text: 'OK'}],
            )} />
          {drive && !driveEmail ? (
            <Row index="02" label="Sign in to Drive" value="TAP" onPress={onConnectDrive} last />
          ) : null}
          {drive && driveEmail ? (
            <Row index="03" label="Disconnect Drive" destructive onPress={onDisconnectDrive} last />
          ) : null}
          {!drive ? (
            <View style={{paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.border}}>
              <Field label="GOOGLE OAUTH CLIENT ID" value={draftClientId} onChangeText={setDraftClientId} autoCapitalize="none" />
              <TouchableOpacity
                onPress={onSaveClientId}
                style={{paddingVertical: 10, alignItems: 'center', backgroundColor: palette.accent, marginTop: 8}}>
                <Text style={[type.h2, {color: palette.bg, fontSize: 12, letterSpacing: 0.5}]}>SAVE CLIENT ID</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Section>

        <Section index="05" title="PREFERENCES">
          <Row index="00" label="Default Agent" value="NONE" onPress={() => setScreen('agents')} last />
        </Section>

        <Section index="06" title="ACCOUNT">
          <SignOutRow signingOut={signingOut} slideX={slideX} onPress={onSignOut} />
        </Section>

        <Text style={[type.monoMuted, {marginTop: spacing.lg, textAlign: 'center', color: palette.textGhost}]}>
          HERMES AGENT v0.6.0  ·  CLIENT
        </Text>
      </View>
    </ScrollView>
  );
}

/** Theme picker card. Shows the theme's three swatches + name + a check
 *  when it's the active one. Tapping applies the theme immediately. */
const ThemeCard: React.FC<{
  theme: Theme;
  active: boolean;
  onPress: () => void;
}> = ({theme, active, onPress}) => {
  const {palette, spacing, type, radii} = useTheme();
  const [bg, accent, fg] = theme.meta.swatches;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        width: '47%',
        backgroundColor: theme.palette.surface,
        borderRadius: radii.lg,
        borderWidth: 2, borderColor: active ? theme.palette.accent : palette.border,
        overflow: 'hidden',
      }}>
      {/* Mini-preview: three swatches stacked like a tiny landscape */}
      <View style={{height: 56, flexDirection: 'row'}}>
        <View style={{flex: 1, backgroundColor: bg}} />
        <View style={{flex: 1, backgroundColor: fg, alignItems: 'center', justifyContent: 'center'}}>
          <View style={{width: 20, height: 4, backgroundColor: accent, borderRadius: 2}} />
        </View>
        <View style={{flex: 1, backgroundColor: accent}} />
      </View>
      <View style={{padding: spacing.md, backgroundColor: theme.palette.surface}}>
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
          <Text style={[type.h2, {fontSize: 13, color: theme.palette.text}]}>{theme.meta.name}</Text>
          {active ? <CheckIcon size={14} color={theme.palette.accent} /> : null}
        </View>
        <Text style={[type.body, {color: theme.palette.textMuted, marginTop: 2, fontSize: 11}]} numberOfLines={1}>
          {theme.meta.tagline}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const SignOutRow: React.FC<{signingOut: boolean; slideX: Animated.Value; onPress: () => void}> = ({signingOut, slideX, onPress}) => {
  const {palette, type, spacing} = useTheme();
  const knob = 36;
  return (
    <View>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 14}}>
        <Text style={[type.mono, {width: 32, color: palette.textDim, fontSize: 11}]}>00</Text>
        <Text style={[type.body, {flex: 1, color: palette.error}]}>SIGN OUT</Text>
      </View>
      <View style={{
        height: 40, borderWidth: 1, borderColor: palette.border,
        backgroundColor: palette.surface, justifyContent: 'center',
        marginTop: 4, marginBottom: 8, paddingHorizontal: 2,
      }}>
        <Text style={[type.monoMuted, {fontSize: 10, color: palette.textDim, paddingLeft: 12, position: 'absolute'}]}>
          {signingOut ? 'SIGNING OUT…' : 'SLIDE TO CONFIRM  →'}
        </Text>
        <Animated.View
          style={{
            position: 'absolute', left: 2, top: 2,
            width: knob, height: knob - 4,
            backgroundColor: palette.error,
            transform: [{translateX: slideX.interpolate({inputRange: [0, 1], outputRange: [0, 250]})}],
          }}
        />
        <View style={{flex: 1}} />
        <TouchableOpacity disabled={signingOut} onPress={onPress} style={{width: 36, height: 36, marginRight: 2, alignSelf: 'center'}} />
      </View>
    </View>
  );
};
