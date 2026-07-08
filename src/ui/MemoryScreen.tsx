/**
 * MemoryScreen — read-only panel for agent memory.
 *
 * Hermes Agent's memory is persisted on the server (`memory.*` keys), but
 * there's no `memory.read` RPC exposed by the running server. Instead this
 * screen renders the agent's *visible* memory — config keys, recent session
 * titles, project facts, and any notes the user has stored locally — so the
 * user can audit what the agent is carrying into context.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, RefreshControl, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {DatabaseIcon, RefreshIcon, ServerIcon, ChevronRightIcon, FileTextIcon} from './icons';
import {notesStore} from '../api/notesStore';

interface MemoryRow {
  source: string;
  key: string;
  value: string;
}

export default function MemoryScreen() {
  const {engine, cachedSessions, serverOnline, refreshCachedSessions} = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [refreshing, setRefreshing] = useState(false);
  const [configRows, setConfigRows] = useState<MemoryRow[]>([]);
  const [facts, setFacts] = useState<any>(null);
  const [noteCount, setNoteCount] = useState<number>(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCachedSessions();
      const rows: MemoryRow[] = [];
      if (engine?.id === 'desktop') {
        try {
          const r = await (engine as any).getConfig?.('reasoning');
          if (r) rows.push({source: 'config', key: 'reasoning', value: JSON.stringify(r.value)});
        } catch {/* fine */}
        try {
          const p = await (engine as any).getConfig?.('personality');
          if (p) rows.push({source: 'config', key: 'personality', value: JSON.stringify(p.value)});
        } catch {/* fine */}
        try {
          const f = await (engine as any).projectFacts?.();
          if (f) setFacts(f);
        } catch {/* fine */}
      }
      setConfigRows(rows);
      try {
        const cfg = await notesStore.loadConfig();
        if (cfg) {
          const list = await notesStore.list();
          setNoteCount(list.length);
        }
      } catch {/* fine */}
    } finally {
      setRefreshing(false);
    }
  }, [engine, refreshCachedSessions]);

  useEffect(() => { void load(); }, [load]);

  const renderRow = (r: MemoryRow, i: number) => (
    <View
      key={`${r.source}-${r.key}-${i}`}
      style={{
        flexDirection: 'row', alignItems: 'flex-start',
        paddingHorizontal: spacing.lg, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
      <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont, minWidth: 64}]}>
        {r.source.toUpperCase()}
      </Text>
      <View style={{flex: 1, marginLeft: 8}}>
        <Text style={[type.body, {color: palette.text, fontSize: 13}]}>{r.key}</Text>
        <Text style={[type.mono, {color: palette.textDim, fontSize: 11, marginTop: 2, fontFamily: monoFont}]} numberOfLines={4}>
          {r.value}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>MEMORY</Text>
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginRight: 8, fontFamily: monoFont}]}>
          read-only
        </Text>
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

        {/* Config keys */}
        <SectionHeader title="CONFIG KEYS" subtitle="Agent's known settings the server exposes via config.get." />
        {!serverOnline ? (
          <Empty text="Server offline · cannot read config keys." />
        ) : configRows.length === 0 ? (
          <Empty text="No exposed config keys." />
        ) : (
          configRows.map(renderRow)
        )}

        {/* Project facts */}
        <SectionHeader title="PROJECT FACTS" subtitle="Detected root + manifests from the active session." />
        {!serverOnline ? (
          <Empty text="Server offline · cannot read project facts." />
        ) : !facts ? (
          <Empty text="No project facts (server didn't reply)." />
        ) : (
          <View style={{paddingHorizontal: spacing.lg, paddingVertical: 10}}>
            {Object.entries(facts.facts ?? facts ?? {}).map(([k, v]) => (
              <View key={k} style={{marginBottom: 6}}>
                <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>{k}</Text>
                <Text style={[type.body, {color: palette.text, fontSize: 12, marginTop: 2}]} numberOfLines={6}>
                  {Array.isArray(v) ? v.join(', ') : String(v)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Recent session titles (cached locally — readable offline) */}
        <SectionHeader title="RECENT SESSIONS" subtitle={`${cachedSessions.length} cached on this device.`} />
        {cachedSessions.length === 0 ? (
          <Empty text="No cached sessions yet." />
        ) : cachedSessions.slice(0, 20).map(s => (
          <View
            key={s.id}
            style={{
              paddingHorizontal: spacing.lg, paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: palette.border,
            }}>
            <Text style={[type.body, {color: palette.text, fontSize: 13}]} numberOfLines={1}>
              {s.title?.trim() || s.preview?.slice(0, 56) || s.id}
            </Text>
            <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4}}>
              {s.model ? (
                <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginRight: 8, fontFamily: monoFont}]}>
                  {s.model}
                </Text>
              ) : null}
              <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                {s.id}
              </Text>
            </View>
          </View>
        ))}

        {/* Notes (local Drive-backed, if signed in) */}
        <SectionHeader title="LOCAL NOTES" subtitle="Personal notes on this device." />
        <View
          style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: spacing.lg, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: palette.border,
          }}>
          <FileTextIcon size={14} color={palette.textDim} />
          <Text style={[type.body, {color: palette.text, fontSize: 13, marginLeft: 10, flex: 1}]}>
            {noteCount} notes
          </Text>
          <ChevronRightIcon size={14} color={palette.textDim} />
        </View>
      </ScrollView>
    </View>
  );
};

const SectionHeader: React.FC<{title: string; subtitle?: string}> = ({title, subtitle}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 4}}>
      <Text style={[type.label, {color: palette.textMuted}]}>{title}</Text>
      {subtitle ? (
        <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 11, marginTop: 2}]}>{subtitle}</Text>
      ) : null}
    </View>
  );
};

const Empty: React.FC<{text: string}> = ({text}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{paddingHorizontal: spacing.lg, paddingVertical: 12}}>
      <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12}]}>{text}</Text>
    </View>
  );
};
