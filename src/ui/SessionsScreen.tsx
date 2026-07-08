/**
 * SessionsScreen — browse, search, and resume past conversations.
 *
 * Sources merged:
 *   - server `session.list` (real metadata, model, message_count, status)
 *   - server `session.active_list` (live "currently open" sessions)
 *   - local sessionCache (read-only, used when the server is unreachable)
 *
 * Tap a row → resumeSession(id) → sets currentSession, loads history, navigates to chat.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, FlatList, TouchableOpacity, TextInput, RefreshControl, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {SearchIcon, RefreshIcon, ChevronRightIcon, PlusIcon, WifiOffIcon, CpuIcon, ClockIcon} from './icons';
import type {SessionSummary} from '../api/hermesClient';

function formatWhen(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toISOString().slice(0, 10);
}

export default function SessionsScreen() {
  const {engine, serverOnline, sessions, refreshSessions, resumeSession, cachedSessions, refreshCachedSessions, engineClient} = useApp();
  const {palette, spacing, type} = useTheme();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      if (engine?.id === 'desktop') {
        const live = await (engine as any).listActiveSessions?.();
        setActive(live ?? []);
      }
      await refreshSessions();
      await refreshCachedSessions();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [engine, refreshSessions, refreshCachedSessions]);

  useEffect(() => { void load(); }, [load]);

  // Merge live + server-known + cached, dedupe by id.
  const merged = useMemo(() => {
    const map = new Map<string, SessionSummary & {cached?: boolean}>();
    for (const c of cachedSessions) map.set(c.id, {...c, cached: true});
    for (const s of sessions) {
      const existing = map.get(s.id);
      map.set(s.id, {...existing, ...s, cached: existing?.cached});
    }
    for (const a of active) {
      const existing = map.get(a.id);
      map.set(a.id, {...existing, ...a, cached: existing?.cached});
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.last_active ?? b.started_at ?? 0) - (a.last_active ?? a.started_at ?? 0),
    );
  }, [cachedSessions, sessions, active]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(s =>
      (s.title ?? '').toLowerCase().includes(q) ||
      (s.preview ?? '').toLowerCase().includes(q) ||
      (s.model ?? '').toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q),
    );
  }, [merged, query]);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>SESSIONS</Text>
        {!serverOnline ? (
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 8}}>
            <WifiOffIcon size={12} color={palette.textDim} />
            <Text style={[type.mono, {color: palette.textDim, fontSize: 9, marginLeft: 4, fontFamily: monoFont}]}>OFFLINE</Text>
          </View>
        ) : null}
        <TouchableOpacity onPress={load} style={{padding: 6}} hitSlop={{top:8, bottom:8, left:8, right:8}}>
          <RefreshIcon size={16} color={palette.textDim} />
        </TouchableOpacity>
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 8,
        backgroundColor: palette.surfaceAlt,
      }}>
        <SearchIcon size={14} color={palette.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="search title, model, id…"
          placeholderTextColor={palette.textGhost}
          style={{
            flex: 1, color: palette.text, fontSize: 13,
            paddingVertical: 8, paddingHorizontal: 8,
            fontFamily: monoFont,
          }}
        />
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
          {filtered.length}/{merged.length}
        </Text>
      </View>

      {error ? (
        <View style={{padding: spacing.lg}}>
          <Text style={[type.bodyMuted, {color: palette.error, fontSize: 12}]}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={s => s.id}
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }
        ListEmptyComponent={
          <View style={{padding: spacing.xl, alignItems: 'center'}}>
            <Text style={[type.label, {color: palette.textMuted}]}>NO SESSIONS</Text>
            <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, marginTop: 8, textAlign: 'center', maxWidth: 280}]}>
              Start a new chat to see it appear here. Cached sessions stay readable when the server is unreachable.
            </Text>
          </View>
        }
        renderItem={({item}) => (
          <SessionRow
            s={item}
            onPress={() => { void resumeSession(item.id); }}
            monoFont={monoFont}
          />
        )}
      />
    </View>
  );
}

const SessionRow: React.FC<{s: SessionSummary & {cached?: boolean}; onPress: () => void; monoFont?: any}> = ({s, onPress, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  const title = s.title?.trim() || s.preview?.slice(0, 56) || s.id.slice(0, 16);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        paddingHorizontal: spacing.lg, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <View style={{flex: 1, marginRight: 8}}>
          <Text style={[type.body, {color: palette.text, fontSize: 14}]} numberOfLines={1}>
            {title}
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8}}>
            {s.model ? (
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <CpuIcon size={10} color={palette.textDim} />
                <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginLeft: 4, fontFamily: monoFont}]}>
                  {s.model}
                </Text>
              </View>
            ) : null}
            {(s.message_count != null) ? (
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                  · {s.message_count} msg
                </Text>
              </View>
            ) : null}
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <ClockIcon size={10} color={palette.textDim} />
              <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginLeft: 4, fontFamily: monoFont}]}>
                {formatWhen(s.last_active ?? s.started_at)}
              </Text>
            </View>
            {s.cached ? (
              <Text style={[type.mono, {color: palette.accent, fontSize: 9, fontFamily: monoFont}]}>
                · cached
              </Text>
            ) : null}
          </View>
        </View>
        <ChevronRightIcon size={14} color={palette.textDim} />
      </View>
    </TouchableOpacity>
  );
};
