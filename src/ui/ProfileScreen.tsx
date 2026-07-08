/**
 * Profile tab — terminal-style user/connection status.
 * No big avatar. Replaced with `USER:diego` header. Lists are flat rows
 * with `LABEL ──── VALUE` formatting, separated by `·`.
 */
import React from 'react';
import {View, ScrollView, Text, TouchableOpacity} from 'react-native';
import {useApp} from './AppContext';
import {palette, spacing, type} from './theme';

export default function ProfileScreen() {
  const {config, client, currentSession} = useApp();
  const sessionShort = currentSession ? currentSession.slice(0, 8) + '…' : 'NONE';

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: palette.bg}}
      contentContainerStyle={{paddingBottom: 40}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <Text style={type.label}>PROFILE</Text>

        {/* Terminal-style header */}
        <View style={{marginTop: spacing.lg}}>
          <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 11}]}>
            USER
          </Text>
          <Text style={[type.displaySmall, {marginTop: 4, fontSize: 28, lineHeight: 32}]}>
            {config.username}
          </Text>
        </View>

        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.xl}} />

        {/* Section: CONNECTION */}
        <View style={{marginTop: spacing.lg}}>
          <Text style={type.label}>CONNECTION</Text>
          <Row label="HOST" value={`${config.host}:${config.port}`} />
          <Row label="USER" value={config.username} />
          <Row label="STATUS" value={client ? 'ONLINE' : 'OFFLINE'} accent={client ? palette.active : palette.error} last />
        </View>

        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.lg}} />

        {/* Section: SESSION */}
        <View style={{marginTop: spacing.lg}}>
          <Text style={type.label}>SESSION</Text>
          <Row label="ACTIVE" value={sessionShort} last />
        </View>

        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.lg}} />

        {/* Section: APP */}
        <View style={{marginTop: spacing.lg}}>
          <Text style={type.label}>CLIENT</Text>
          <Row label="VERSION" value="0.4.0" last />
        </View>

        <View style={{height: 1, backgroundColor: palette.hairline, marginTop: spacing.lg}} />
        <Text style={[type.monoMuted, {marginTop: spacing.lg, textAlign: 'center', color: palette.textGhost}]}>
          ⎔ HERMES AGENT
        </Text>
      </View>
    </ScrollView>
  );
}

const Row: React.FC<{label: string; value: string; accent?: string; last?: boolean}> = ({label, value, accent, last}) => (
  <View style={{
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: last ? 0 : 1, borderTopColor: palette.hairline,
  }}>
    <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 11, width: 80}]}>
      {label}
    </Text>
    <Text style={[type.mono, {flex: 1, fontSize: 12, color: accent ?? palette.text}]} numberOfLines={1}>
      {value}
    </Text>
  </View>
);
