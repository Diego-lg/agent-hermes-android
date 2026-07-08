/**
 * InsightsScreen — usage analytics derived from cached sessions.
 *
 * The Hermes server doesn't yet expose an analytics endpoint. We compute the
 * rollups locally from cached session summaries + usage payloads attached to
 * finished assistant messages.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, RefreshControl, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ChartBarIcon, RefreshIcon, CpuIcon, HashIcon, ClockIcon} from './icons';

export default function InsightsScreen() {
  const {cachedSessions, refreshCachedSessions, messages, currentSession} = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { await refreshCachedSessions(); } finally { setRefreshing(false); }
  }, [refreshCachedSessions]);

  useEffect(() => { void load(); }, [load]);

  // Roll up usage stats from current session messages.
  const totals = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let calls = 0;
    let contextUsed = 0;
    let contextMax = 0;
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.usage) continue;
      calls += 1;
      inputTokens += m.usage.input ?? 0;
      outputTokens += m.usage.output ?? 0;
      contextUsed = Math.max(contextUsed, m.usage.context_used ?? 0);
      contextMax = Math.max(contextMax, m.usage.context_max ?? 0);
    }
    return {inputTokens, outputTokens, calls, contextUsed, contextMax};
  }, [messages]);

  // Model usage tally across cached sessions.
  const modelTally = useMemo(() => {
    const m = new Map<string, {count: number; msgs: number}>();
    for (const s of cachedSessions) {
      const id = s.model ?? '(unknown)';
      const cur = m.get(id) ?? {count: 0, msgs: 0};
      cur.count += 1;
      cur.msgs += s.message_count ?? 0;
      m.set(id, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].msgs - a[1].msgs);
  }, [cachedSessions]);

  // Daily activity across the last 14 days.
  const dailyActivity = useMemo(() => {
    const buckets = new Map<string, number>();
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() - i * 86400_000);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const s of cachedSessions) {
      const ts = s.last_active ?? s.started_at;
      if (!ts) continue;
      const key = new Date(ts * 1000).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + (s.message_count ?? 0));
    }
    return Array.from(buckets.entries()).reverse();
  }, [cachedSessions]);

  const maxBar = Math.max(1, ...dailyActivity.map(([_, v]) => v));

  const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>INSIGHTS</Text>
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

        {/* Current session totals */}
        <SectionHeader title="CURRENT SESSION" subtitle={`${currentSession?.slice(0, 8) ?? '(none)'}`} />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: spacing.sm}}>
          <Stat label="INPUT" value={fmtNum(totals.inputTokens)} unit="tok" />
          <Stat label="OUTPUT" value={fmtNum(totals.outputTokens)} unit="tok" />
          <Stat label="CALLS" value={String(totals.calls)} unit="turns" />
          <Stat
            label="CONTEXT"
            value={totals.contextMax
              ? `${Math.round((totals.contextUsed / totals.contextMax) * 100)}`
              : '0'}
            unit={totals.contextMax ? `of ${fmtNum(totals.contextMax)}` : '—'}
          />
        </View>

        {/* Activity */}
        <SectionHeader title="ACTIVITY · 14d" subtitle="Messages per day across cached sessions." />
        <View style={{paddingHorizontal: spacing.lg, paddingVertical: 8}}>
          <View style={{flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 4}}>
            {dailyActivity.map(([day, v]) => {
              const h = Math.max(2, Math.round((v / maxBar) * 70));
              return (
                <View key={day} style={{flex: 1, alignItems: 'center'}}>
                  <View style={{
                    width: '100%', height: h,
                    backgroundColor: v ? palette.accent : palette.surfaceAlt,
                  }} />
                </View>
              );
            })}
          </View>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 6}}>
            <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>
              {dailyActivity[0]?.[0] ?? ''}
            </Text>
            <Text style={[type.mono, {color: palette.textDim, fontSize: 9, fontFamily: monoFont}]}>
              {dailyActivity[dailyActivity.length - 1]?.[0] ?? ''}
            </Text>
          </View>
        </View>

        {/* Model tally */}
        <SectionHeader title="MODELS" subtitle="Sessions + total messages, sorted by message volume." />
        {modelTally.length === 0 ? (
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, paddingHorizontal: spacing.lg}]}>
            No cached sessions yet.
          </Text>
        ) : modelTally.map(([id, {count, msgs}]) => {
          const maxMsgs = modelTally[0][1].msgs || 1;
          const w = Math.max(8, Math.round((msgs / maxMsgs) * 100));
          return (
            <View
              key={id}
              style={{
                paddingHorizontal: spacing.lg, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: palette.border,
              }}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <CpuIcon size={12} color={palette.accent} />
                <Text style={[type.body, {color: palette.text, fontSize: 13, marginLeft: 8, flex: 1}]} numberOfLines={1}>
                  {id}
                </Text>
                <Text style={[type.mono, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
                  {count} sessions · {msgs} msg
                </Text>
              </View>
              <View style={{height: 4, backgroundColor: palette.surfaceAlt, marginTop: 6, marginLeft: 20}}>
                <View style={{height: 4, width: `${w}%`, backgroundColor: palette.accent}} />
              </View>
            </View>
          );
        })}

        {/* Aggregate */}
        <SectionHeader title="AGGREGATE" subtitle="Across all cached sessions on this device." />
        <View style={{flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: 20}}>
          <Stat label="SESSIONS" value={String(cachedSessions.length)} />
          <Stat
            label="MESSAGES"
            value={fmtNum(cachedSessions.reduce((s, x) => s + (x.message_count ?? 0), 0))}
          />
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

const Stat: React.FC<{label: string; value: string; unit?: string}> = ({label, value, unit}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <View style={{
      flexBasis: '47%',
      padding: spacing.md,
      borderWidth: 1, borderColor: palette.border,
      backgroundColor: palette.surface,
    }}>
      <Text style={[type.label, {color: palette.textMuted, fontSize: 9}]}>{label}</Text>
      <View style={{flexDirection: 'row', alignItems: 'baseline', marginTop: 4}}>
        <Text style={[type.h1, {color: palette.text, fontSize: 22}]}>{value}</Text>
        {unit ? (
          <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginLeft: 6}]}>{unit}</Text>
        ) : null}
      </View>
    </View>
  );
};
