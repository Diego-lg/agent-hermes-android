/**
 * SkillsScreen — browse and search the server's installed skills.
 *
 * The desktop Hermes server exposes its skill surface via `commands.catalog`
 * (the slash-command catalog). Each pair is a (name, description) tuple that
 * the agent can invoke. We render this list as browsable skills with search.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, FlatList, TextInput, TouchableOpacity, RefreshControl, Platform} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {SearchIcon, RefreshIcon, HashIcon, ChevronRightIcon, InfoIcon} from './icons';

interface SkillEntry {
  name: string;
  description: string;
  usage?: string;
}

export default function SkillsScreen() {
  const {engine, serverOnline} = useApp();
  const {palette, spacing, type} = useTheme();
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      if (engine?.id === 'desktop') {
        const cmds = await (engine as any).listCommands?.();
        if (Array.isArray(cmds)) setSkills(cmds);
      } else {
        setSkills([]);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRefreshing(false);
    }
  }, [engine]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
        <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>SKILLS</Text>
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, marginRight: 8, fontFamily: monoFont}]}>
          {skills.length} total
        </Text>
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
          placeholder="search skills…"
          placeholderTextColor={palette.textGhost}
          style={{
            flex: 1, color: palette.text, fontSize: 13,
            paddingVertical: 8, paddingHorizontal: 8,
            fontFamily: monoFont,
          }}
        />
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, fontFamily: monoFont}]}>
          {filtered.length}/{skills.length}
        </Text>
      </View>

      {error ? (
        <View style={{padding: spacing.lg}}>
          <Text style={[type.bodyMuted, {color: palette.error, fontSize: 12}]}>{error}</Text>
        </View>
      ) : !serverOnline ? (
        <View style={{padding: spacing.lg, alignItems: 'center'}}>
          <InfoIcon size={20} color={palette.textDim} />
          <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, marginTop: 8, textAlign: 'center'}]}>
            Server offline · connect to your desktop to browse installed skills.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={s => s.name}
        contentContainerStyle={{paddingBottom: 40}}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load}
            tintColor={palette.textMuted} colors={[palette.text]} />
        }
        ListEmptyComponent={
          !serverOnline ? null : (
            <View style={{padding: spacing.xl, alignItems: 'center'}}>
              <Text style={[type.label, {color: palette.textMuted}]}>NO SKILLS</Text>
              <Text style={[type.bodyMuted, {color: palette.textDim, fontSize: 12, marginTop: 8, textAlign: 'center'}]}>
                Server returned no commands.
              </Text>
            </View>
          )
        }
        renderItem={({item}) => <SkillRow s={item} monoFont={monoFont} />}
      />
    </View>
  );
}

const SkillRow: React.FC<{s: SkillEntry; monoFont?: any}> = ({s, monoFont}) => {
  const {palette, spacing, type} = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      style={{
        paddingHorizontal: spacing.lg, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: palette.border,
      }}>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <HashIcon size={13} color={palette.accent} />
        <Text style={[type.mono, {color: palette.accent, fontSize: 12, marginLeft: 8, fontFamily: monoFont}]}>
          {s.name}
        </Text>
      </View>
      {s.description ? (
        <Text style={[type.bodyMuted, {color: palette.textMuted, fontSize: 12, marginTop: 4, marginLeft: 21}]} numberOfLines={3}>
          {s.description}
        </Text>
      ) : null}
      {s.usage ? (
        <Text style={[type.mono, {color: palette.textDim, fontSize: 10, marginTop: 4, marginLeft: 21, fontFamily: monoFont}]}>
          {s.usage}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};
