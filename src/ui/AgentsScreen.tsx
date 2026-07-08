/**
 * Agents tab — modern list. Theme-aware.
 */
import React from 'react';
import {View, ScrollView, TouchableOpacity, Text} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {AGENT_CATALOG, AgentDef} from '../agents/catalog';
import {ChevronRightIcon} from './icons';

export default function AgentsScreen() {
  const {setScreen, openOrCreateSession} = useApp();
  const {palette, spacing, type} = useTheme();

  const onLaunch = async (a: AgentDef) => {
    await openOrCreateSession(a.id);
    setScreen('chat');
  };

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: palette.bg}}
      contentContainerStyle={{paddingBottom: 40}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <Text style={type.label}>AGENTS</Text>
        <Text style={[type.displaySmall, {marginTop: spacing.sm}]}>Sub-agents</Text>
        <Text style={[type.body, {color: palette.textMuted, marginTop: 6, fontSize: 12, maxWidth: 280}]}>
          Pre-configured specialists. Each opens a chat pre-loaded with a system prompt for that role.
        </Text>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.xl}} />

        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm}}>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10}]}>01</Text>
          <View style={{width: 1, height: 12, backgroundColor: palette.border, marginHorizontal: spacing.sm}} />
          <Text style={type.label}>BUILT-IN</Text>
        </View>

        {AGENT_CATALOG.map((a, idx) => {
          const IconCmp = a.icon;
          const prefix = a.name.toUpperCase().slice(0, 2);
          return (
            <TouchableOpacity
              key={a.id}
              activeOpacity={0.6}
              onPress={() => onLaunch(a)}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: spacing.md,
                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: palette.border,
              }}>
              <Text style={[type.mono, {width: 28, color: palette.textDim}]}>{prefix}</Text>
              <View style={{flex: 1}}>
                <Text style={[type.h2, {fontSize: 13, letterSpacing: 0.2}]}>{a.name.toUpperCase()}</Text>
                <Text style={[type.body, {color: palette.textMuted, marginTop: 3, fontSize: 11}]} numberOfLines={1}>
                  {a.description}
                </Text>
              </View>
              <ChevronRightIcon size={16} color={palette.textDim} />
            </TouchableOpacity>
          );
        })}

        <View style={{height: 1, backgroundColor: palette.border}} />

        <View style={{flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm}}>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10}]}>02</Text>
          <View style={{width: 1, height: 12, backgroundColor: palette.border, marginHorizontal: spacing.sm}} />
          <Text style={type.label}>COMING</Text>
        </View>

        <View style={{paddingVertical: spacing.md}}>
          {['CUSTOM AGENT BUILDER', 'VOICE & IMAGE INPUT', 'PUSH NOTIFICATIONS'].map((label, i, arr) => (
            <View
              key={label}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: spacing.sm,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: palette.border,
              }}>
              <Text style={[type.mono, {width: 28, color: palette.textGhost, fontSize: 10}]}>
                {String(i + 7).padStart(2, '0')}
              </Text>
              <Text style={[type.body, {color: palette.textMuted, fontSize: 12, letterSpacing: 0.3}]}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
