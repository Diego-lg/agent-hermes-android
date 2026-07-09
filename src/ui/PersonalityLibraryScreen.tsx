/**
 * PersonalityLibraryScreen — browse/search the personality library, clone or
 * edit, and create custom personalities (name, blurb, icon, color, system
 * prompt, model, MiniMax voice + prosody). Reuses the app's list/editor styling
 * and the MiniMax voice-browser pattern from ModelsScreen.
 */
import React, {useEffect, useMemo, useState, useCallback} from 'react';
import {View, ScrollView, TouchableOpacity, Text, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {Field, Button} from './atoms';
import {
  personaIcon, PERSONA_ICON_KEYS, PlusIcon, XIcon, SearchIcon, CopyIcon,
  TrashIcon, ChevronLeftIcon, Volume2Icon, RefreshIcon, PlayIcon, CheckIcon,
} from './icons';
import {makePersonalityStore, Personality, newPersonality, isBuiltin} from '../api/personalityStore';
import {SPEECH_MODELS, SYSTEM_VOICES, EMOTIONS, Emotion} from '../api/minimaxVoice';
import {useVoice} from './useVoice';
import {useGroupRunner} from './groupRunner';

const monoFont = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});

const PERSONA_COLORS = [
  '#e0932f', '#d9503f', '#dd6a2e', '#c99a2e', '#7f9f2e', '#3f9d69', '#2f9d7a',
  '#1fa896', '#159ba6', '#2f8fd0', '#3f7de0', '#6a82e0', '#7a6fe0', '#8a5fd0',
  '#a24fd0', '#cf4fa0', '#d95f8a', '#6b7688', '#5f6b7d', '#8a7f6a',
];

/** Round icon badge = persona icon on a tint of its accent color. */
export const PersonaBadge: React.FC<{icon: string; color: string; size?: number; badge?: number}> = ({
  icon, color, size = 20, badge = 40,
}) => {
  const Icon = personaIcon(icon);
  return (
    <View style={{
      width: badge, height: badge, borderRadius: badge / 2,
      backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon size={size} color={color} />
    </View>
  );
};

export default function PersonalityLibraryScreen() {
  const {palette, spacing, type} = useTheme();
  const store = useMemo(() => makePersonalityStore(), []);
  const [list, setList] = useState<Personality[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Personality | null>(null);
  const [isNew, setIsNew] = useState(false);

  const reload = useCallback(async () => setList(await store.load()), [store]);
  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.blurb.toLowerCase().includes(q) ||
      p.systemPrompt.toLowerCase().includes(q));
  }, [list, query]);

  const openNew = () => { setEditing(newPersonality()); setIsNew(true); };
  const openExisting = (p: Personality) => { setEditing({...p}); setIsNew(false); };

  if (editing) {
    return (
      <PersonalityEditor
        draft={editing}
        isNew={isNew}
        onChange={patch => setEditing(prev => (prev ? {...prev, ...patch} : prev))}
        onClose={() => setEditing(null)}
        onSaved={async next => { await reload(); setEditing(null); }}
        onCloneEdit={src => {
          const base = newPersonality();
          setEditing({...src, id: base.id, builtin: false, name: `${src.name} (copy)`});
          setIsNew(true);
        }}
        store={store}
      />
    );
  }

  const builtins = filtered.filter(p => p.builtin);
  const customs = filtered.filter(p => !p.builtin);

  const Row = (p: Personality, idx: number, first: boolean) => (
    <TouchableOpacity
      key={p.id}
      activeOpacity={0.6}
      onPress={() => openExisting(p)}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md,
        borderTopWidth: first ? 0 : 1, borderTopColor: palette.border,
      }}>
      <PersonaBadge icon={p.icon} color={p.color} />
      <View style={{flex: 1, marginLeft: spacing.md}}>
        <Text style={[type.h2, {fontSize: 14}]}>{p.name}</Text>
        <Text style={[type.body, {color: palette.textMuted, marginTop: 2, fontSize: 12}]} numberOfLines={1}>
          {p.blurb}
        </Text>
      </View>
      {p.builtin
        ? <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>BUILT-IN</Text>
        : <CopyIcon size={15} color={palette.textDim} />}
    </TouchableOpacity>
  );

  return (
    <ScrollView style={{flex: 1, backgroundColor: palette.bg}} contentContainerStyle={{paddingBottom: 48}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <Text style={type.label}>PERSONAS</Text>
        <View style={{flexDirection: 'row', alignItems: 'flex-end'}}>
          <Text style={[type.displaySmall, {marginTop: spacing.sm, flex: 1}]}>Personalities</Text>
          <TouchableOpacity
            onPress={openNew}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 8,
              borderWidth: 1, borderColor: palette.accent,
              backgroundColor: palette.accentMuted ?? palette.surfaceAlt,
              borderRadius: 8,
            }}>
            <PlusIcon size={14} color={palette.accent} />
            <Text style={[type.mono, {color: palette.accent, fontSize: 11, fontFamily: monoFont}]}>NEW</Text>
          </TouchableOpacity>
        </View>

        <View style={{
          flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg,
          backgroundColor: palette.surfaceAlt, borderRadius: 10,
          borderWidth: 1, borderColor: palette.border, paddingHorizontal: 12,
        }}>
          <SearchIcon size={15} color={palette.textDim} />
          <Field
            label=""
            value={query}
            onChangeText={setQuery}
            placeholder="Search personalities"
            style={{backgroundColor: 'transparent', borderWidth: 0, flex: 1, paddingVertical: 8}}
          />
        </View>

        {customs.length > 0 && (
          <>
            <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.lg, marginBottom: 4}]}>YOURS</Text>
            {customs.map((p, i) => Row(p, i, i === 0))}
          </>
        )}

        <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.lg, marginBottom: 4}]}>
          BUILT-IN · {builtins.length}
        </Text>
        {builtins.map((p, i) => Row(p, i, i === 0))}
      </View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------------- */
/* Editor + voice controls                                                    */
/* ------------------------------------------------------------------------- */

interface EditorProps {
  draft: Personality;
  isNew: boolean;
  onChange: (patch: Partial<Personality>) => void;
  onClose: () => void;
  onSaved: (list: Personality[]) => void | Promise<void>;
  onCloneEdit: (src: Personality) => void;
  store: ReturnType<typeof makePersonalityStore>;
}

const PersonalityEditor: React.FC<EditorProps> = ({draft, isNew, onChange, onClose, onSaved, onCloneEdit, store}) => {
  const {palette, spacing, type} = useTheme();
  const {recentModels} = useApp();
  const readOnly = !!draft.builtin;

  const save = async () => {
    if (!draft.name.trim()) return;
    const list = await store.add(draft);
    await onSaved(list);
  };
  const remove = async () => {
    const list = await store.remove(draft.id);
    await onSaved(list);
  };

  const chip = (active: boolean) => ({
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1,
    borderColor: active ? palette.accent : palette.border,
    backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
  });

  return (
    <ScrollView style={{flex: 1, backgroundColor: palette.bg}} contentContainerStyle={{paddingBottom: 56}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md}}>
          <TouchableOpacity onPress={onClose} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <ChevronLeftIcon size={22} color={palette.text} />
          </TouchableOpacity>
          <Text style={[type.h1, {flex: 1, marginLeft: spacing.sm}]}>
            {isNew ? 'New personality' : draft.name}
          </Text>
          {readOnly ? (
            <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>BUILT-IN</Text>
          ) : null}
        </View>

        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm}}>
          <PersonaBadge icon={draft.icon} color={draft.color} badge={52} size={26} />
          <View style={{flex: 1, marginLeft: spacing.md}}>
            <Field label="Name" value={draft.name} editable={!readOnly}
              onChangeText={t => onChange({name: t})} placeholder="e.g. Ada the Data Hawk" />
          </View>
        </View>

        <Field label="Blurb" value={draft.blurb} editable={!readOnly}
          onChangeText={t => onChange({blurb: t})} placeholder="One-line description" />

        {/* Icon picker */}
        <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.md, marginBottom: 6}]}>ICON</Text>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          {PERSONA_ICON_KEYS.map(key => {
            const Icon = personaIcon(key);
            const active = draft.icon === key;
            return (
              <TouchableOpacity key={key} disabled={readOnly} onPress={() => onChange({icon: key})}
                style={{
                  width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: active ? draft.color : palette.border,
                  backgroundColor: active ? draft.color + '22' : 'transparent',
                }}>
                <Icon size={20} color={active ? draft.color : palette.textDim} />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Color picker */}
        <Text style={[type.label, {color: palette.textMuted, marginTop: spacing.md, marginBottom: 6}]}>COLOR</Text>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
          {PERSONA_COLORS.map(c => {
            const active = draft.color === c;
            return (
              <TouchableOpacity key={c} disabled={readOnly} onPress={() => onChange({color: c})}
                style={{
                  width: 30, height: 30, borderRadius: 15, backgroundColor: c,
                  borderWidth: active ? 3 : 0, borderColor: palette.text,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                {active ? <CheckIcon size={14} color="#fff" /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{marginTop: spacing.sm}}>
          <Field label="System prompt" value={draft.systemPrompt} editable={!readOnly}
            onChangeText={t => onChange({systemPrompt: t})} multiline
            placeholder="Give this personality a sharp, distinctive voice…"
            style={{minHeight: 120, textAlignVertical: 'top'}} />
        </View>

        {/* Model override */}
        <Field label="Model id (optional)" value={draft.modelId ?? ''} editable={!readOnly}
          onChangeText={t => onChange({modelId: t || undefined})}
          placeholder="Leave blank to use the group's default model" autoCapitalize="none" />
        {!readOnly && recentModels.length > 0 ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4}}>
            {recentModels.slice(0, 6).map(m => (
              <TouchableOpacity key={m} onPress={() => onChange({modelId: m})} style={chip(draft.modelId === m)}>
                <Text style={[type.mono, {color: draft.modelId === m ? palette.accent : palette.textDim, fontSize: 10, fontFamily: monoFont}]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <VoiceControls draft={draft} onChange={onChange} readOnly={readOnly} />

        {/* Footer actions */}
        <View style={{marginTop: spacing.xl, gap: spacing.sm}}>
          {readOnly ? (
            <>
              <Button title="Clone & edit" icon="⧉" onPress={() => onCloneEdit(draft)} />
              <Button title="Close" variant="ghost" onPress={onClose} />
            </>
          ) : (
            <>
              <Button title="Save personality" onPress={save} disabled={!draft.name.trim()} />
              {!isNew ? <Button title="Delete" variant="danger" onPress={remove} /> : null}
              <Button title="Cancel" variant="ghost" onPress={onClose} />
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
};

interface VoiceControlsProps {
  draft: Personality;
  onChange: (patch: Partial<Personality>) => void;
  readOnly: boolean;
}

const VoiceControls: React.FC<VoiceControlsProps> = ({draft, onChange, readOnly}) => {
  const {palette, spacing, type} = useTheme();
  const {allVoices, voicesLoading, voicesError, refreshVoices} = useVoice();
  const {speakAs, audioAvailable, voiceReady, stopSpeaking} = useGroupRunner();
  const [previewing, setPreviewing] = useState(false);

  const systemChips = useMemo(
    () => allVoices.filter(v => v.category === 'system' || v.category === 'generated'),
    [allVoices],
  );
  const voiceList = systemChips.length
    ? systemChips.slice(0, 60)
    : SYSTEM_VOICES.map(v => ({voiceId: v.id, name: v.label}));

  const speed = draft.speed ?? 1;
  const clampSpeed = (v: number) => Math.max(0.5, Math.min(2, Math.round(v * 10) / 10));

  const preview = async () => {
    if (previewing) { await stopSpeaking(); setPreviewing(false); return; }
    setPreviewing(true);
    try {
      await speakAs(
        `Hi, I'm ${draft.name || 'this personality'}.`,
        {voiceId: draft.voiceId, speechModel: draft.speechModel, speed: draft.speed, emotion: draft.emotion},
      );
    } finally {
      setPreviewing(false);
    }
  };

  const chip = (active: boolean) => ({
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
    borderColor: active ? palette.accent : palette.border,
    backgroundColor: active ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
  });
  const chipTxt = (active: boolean) => ([type.mono, {color: active ? palette.accent : palette.textDim, fontSize: 11, fontFamily: monoFont}]);

  return (
    <View style={{marginTop: spacing.lg}}>
      <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
        <Volume2Icon size={14} color={palette.accent} />
        <Text style={[type.label, {color: palette.textMuted, marginLeft: 8, flex: 1}]}>VOICE · MINIMAX</Text>
        {voiceReady && audioAvailable ? (
          <TouchableOpacity onPress={preview} style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
            <PlayIcon size={12} color={palette.accent} />
            <Text style={[type.mono, {color: palette.accent, fontSize: 9, fontFamily: monoFont}]}>
              {previewing ? 'STOP' : 'PREVIEW'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!voiceReady ? (
        <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>
          Add a MiniMax API key (Settings → AI) to give this personality a voice. Text still works without it.
        </Text>
      ) : (
        <>
          <Text style={[type.label, {color: palette.textMuted, marginBottom: 6}]}>SPEECH MODEL</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
            {SPEECH_MODELS.map(m => {
              const active = (draft.speechModel ?? '') === m.id;
              return (
                <TouchableOpacity key={m.id} disabled={readOnly} onPress={() => onChange({speechModel: m.id})} style={chip(active)}>
                  <Text style={chipTxt(active)}>{m.id}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 6}}>
            <Text style={[type.label, {color: palette.textMuted, flex: 1}]}>VOICE</Text>
            <TouchableOpacity onPress={() => void refreshVoices()} disabled={voicesLoading}
              style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
              <RefreshIcon size={12} color={voicesLoading ? palette.textDim : palette.accent} />
              <Text style={[type.mono, {color: voicesLoading ? palette.textDim : palette.accent, fontSize: 9, fontFamily: monoFont}]}>
                {voicesLoading ? 'FETCHING…' : (systemChips.length ? `REFRESH (${systemChips.length})` : 'FETCH ALL')}
              </Text>
            </TouchableOpacity>
          </View>
          {voicesError ? (
            <Text style={[type.monoMuted, {color: palette.error, fontSize: 10, marginBottom: 6}]}>{voicesError}</Text>
          ) : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
            {voiceList.map(v => {
              const active = draft.voiceId === v.voiceId;
              return (
                <TouchableOpacity key={v.voiceId} disabled={readOnly} onPress={() => onChange({voiceId: v.voiceId})} style={chip(active)}>
                  <Text style={chipTxt(active)}>{v.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[type.label, {color: palette.textMuted, marginTop: 12, marginBottom: 6}]}>
            SPEED · {speed.toFixed(1)}×
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
            <TouchableOpacity disabled={readOnly} onPress={() => onChange({speed: clampSpeed(speed - 0.1)})} style={chip(false)}>
              <Text style={chipTxt(false)}>−</Text>
            </TouchableOpacity>
            <Text style={[type.mono, {color: palette.text, fontSize: 13, fontFamily: monoFont, minWidth: 44, textAlign: 'center'}]}>
              {speed.toFixed(1)}×
            </Text>
            <TouchableOpacity disabled={readOnly} onPress={() => onChange({speed: clampSpeed(speed + 0.1)})} style={chip(false)}>
              <Text style={chipTxt(false)}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={[type.label, {color: palette.textMuted, marginTop: 12, marginBottom: 6}]}>EMOTION</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
            {EMOTIONS.map(e => {
              const active = (draft.emotion ?? 'auto') === e;
              return (
                <TouchableOpacity key={e} disabled={readOnly} onPress={() => onChange({emotion: e as Emotion})} style={chip(active)}>
                  <Text style={chipTxt(active)}>{e}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
};
