/**
 * Home tab — industrial dashboard.
 *
 * - Pure black, no card backgrounds
 * - Hairline separators between sections (1px #1f1f1f)
 * - Tabular figures for all numerics
 * - Etched labels (9pt uppercase, wide tracking) like aluminum engravings
 * - Single accent: the "new chat" affordance
 * - Greeting is a huge display line, no card behind it
 * - Token usage as a thin horizontal gauge strip
 */
import React, {useEffect, useState} from 'react';
import {View, ScrollView, TouchableOpacity, RefreshControl, Text} from 'react-native';
import {useApp} from './AppContext';
import {palette, spacing, type} from './theme';
import {PlusIcon, ChevronRightIcon, RefreshIcon} from './icons';
import {AGENT_CATALOG, agentById} from '../agents/catalog';

export default function HomeScreen() {
  const {client, config, sessions, refreshSessions, setScreen, openOrCreateSession, currentSession, setCurrentSession, setMessages} = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [usage, setUsage] = useState<{input: number; output: number; context_percent: number} | null>(null);
  const [activeSubs, setActiveSubs] = useState<number>(0);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshSessions();
      if (currentSession) {
        try { const u = await client?.sessionUsage(currentSession); if (u) setUsage(u); } catch {}
      }
      try { const subs = await client?.listDelegations(); setActiveSubs(subs?.length ?? 0); } catch {}
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { void onRefresh(); }, [client]);

  const recent = sessions.slice(0, 5);
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  // Token usage as a thin gauge (0-100% from server)
  const usagePercent = Math.min(100, Math.max(0, usage?.context_percent ?? 0));

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: palette.bg}}
      contentContainerStyle={{paddingBottom: 40}}
      refreshControl={
        <RefreshControl
          refreshing={refreshing} onRefresh={onRefresh}
          tintColor={palette.textMuted} colors={[palette.text]}
        />
      }>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        {/* Top status row: monospace, etched */}
        <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md}}>
          <View style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: client ? palette.active : palette.error,
            marginRight: 8,
          }} />
          <Text style={type.label}>
            {client ? 'SYSTEM ONLINE' : 'SYSTEM OFFLINE'}  ·  {config.host}
          </Text>
        </View>

        {/* Greeting — huge, single line, no card */}
        <Text style={[type.display, {marginTop: spacing.sm}]}>
          {greeting}
          <Text style={{color: palette.textDim}}>,</Text>
        </Text>
        <Text style={[type.bodyMuted, {marginTop: 4}]}>
          What can Hermes do for you today?
        </Text>

        {/* Hairline rule */}
        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.xl}} />

        {/* Stats — 3 columns, no labels, just big numbers + tiny caption */}
        <View style={{flexDirection: 'row', marginTop: spacing.lg}}>
          <StatCol value={String(usage?.output ?? 0)} label="OUTPUT" />
          <StatCol value={String(activeSubs)} label="AGENTS" />
          <StatCol value={String(sessions.length)} label="SESSIONS" />
        </View>

        {/* Token usage gauge */}
        <View style={{marginTop: spacing.lg}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6}}>
            <Text style={type.label}>CONTEXT USAGE</Text>
            <Text style={type.monoMuted}>{String(usagePercent).padStart(3, ' ')}%</Text>
          </View>
          <View style={{
            height: 2, backgroundColor: palette.surfaceAlt,
            borderRadius: 0, overflow: 'hidden',
          }}>
            <View style={{
              height: 2, width: `${usagePercent}%`,
              backgroundColor: usagePercent > 80 ? palette.error : palette.active,
            }} />
          </View>
        </View>

        {/* Hairline rule */}
        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.xl}} />

        {/* New chat affordance — the only accent element on the screen */}
        <TouchableOpacity
          onPress={() => { void openOrCreateSession().then(() => setScreen('chat')); }}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row', alignItems: 'center',
            paddingVertical: spacing.lg,
          }}>
          <View style={{
            width: 36, height: 36,
            backgroundColor: palette.surfaceAlt,
            borderWidth: 1, borderColor: palette.hairlineStrong,
            alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
          }}>
            <PlusIcon size={18} color={palette.on} />
          </View>
          <View style={{flex: 1}}>
            <Text style={[type.h1, {color: palette.on, fontSize: 15}]}>NEW CHAT</Text>
            <Text style={[type.bodyMuted, {marginTop: 2, fontSize: 12}]}>
              Start a fresh conversation
            </Text>
          </View>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 11}]}>00 ↩</Text>
        </TouchableOpacity>

        <View style={{height: 1, backgroundColor: palette.hairline}} />

        {/* Quick agents row — 3 columns, no card backgrounds */}
        <View style={{flexDirection: 'row', marginTop: spacing.lg}}>
          {AGENT_CATALOG.slice(0, 3).map((a, i) => {
            const IconCmp = a.icon;
            return (
              <TouchableOpacity
                key={a.id}
                activeOpacity={0.6}
                onPress={() => { void openOrCreateSession(a.id).then(() => setScreen('chat')); }}
                style={{
                  flex: 1, paddingVertical: spacing.md, paddingRight: spacing.md,
                  borderRightWidth: i < 2 ? 1 : 0, borderRightColor: palette.hairline,
                }}>
                <IconCmp size={20} color={palette.on} />
                <Text style={[type.h2, {marginTop: 8, fontSize: 13}]}>{a.name.toUpperCase()}</Text>
                <Text style={[type.bodyMuted, {marginTop: 2, fontSize: 11}]} numberOfLines={1}>
                  {a.description}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.lg}} />

        {/* Recent sessions header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginTop: spacing.xl, marginBottom: spacing.sm,
        }}>
          <Text style={type.label}>RECENT</Text>
          <TouchableOpacity onPress={onRefresh} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <RefreshIcon size={14} color={palette.textDim} />
          </TouchableOpacity>
        </View>

        {recent.length === 0 ? (
          <Text style={[type.bodyMuted, {paddingVertical: spacing.lg, fontSize: 12}]}>
            No sessions yet — start one above.
          </Text>
        ) : (
          recent.map((s, idx) => (
            <TouchableOpacity
              key={s.id}
              activeOpacity={0.6}
              onPress={async () => {
                if (!client) return;
                client.setSessionId(s.id);
                setCurrentSession(s.id);
                try {
                  const h = await client.loadHistory(s.id);
                  setMessages(h.map((m: any) => ({role: m.role, text: m.content, ts: m.ts})));
                } catch { setMessages([]); }
                setScreen('chat');
              }}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: spacing.md,
                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: palette.hairline,
              }}>
              <Text style={[type.monoMuted, {width: 28, color: palette.textDim}]}>
                {String(idx).padStart(2, '0')}
              </Text>
              <View style={{flex: 1}}>
                <Text style={[type.body, {fontWeight: '500'}]} numberOfLines={1}>
                  {s.title ?? '(untitled)'}
                </Text>
                <Text style={[type.monoMuted, {marginTop: 2}]} numberOfLines={1}>
                  {s.id.slice(0, 8)}…  ·  {new Date((s.updated_at ?? Date.now() / 1000) * 1000).toLocaleString()}
                </Text>
              </View>
              <ChevronRightIcon size={16} color={palette.textDim} />
            </TouchableOpacity>
          ))
        )}

        <View style={{height: 1, backgroundColor: palette.hairline}} />
        <Text style={[type.monoMuted, {marginTop: spacing.lg, textAlign: 'center', color: palette.textGhost}]}>
          HERMES v0.4.0  ·  CLIENT
        </Text>
      </View>
    </ScrollView>
  );
}

const StatCol: React.FC<{value: string; label: string}> = ({value, label}) => (
  <View style={{flex: 1}}>
    <Text style={type.num}>{value.padStart(3, '0')}</Text>
    <Text style={[type.label, {marginTop: 4}]}>{label}</Text>
  </View>
);
