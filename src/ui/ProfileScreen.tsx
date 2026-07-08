/**
 * Profile tab — terminal-style user/connection status. Theme-aware.
 */
import React from 'react';
import {View, ScrollView, Text, TouchableOpacity} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';

export default function ProfileScreen() {
  const {config, serverOnline, engineLabel, currentSession} = useApp();
  const {palette, spacing, type} = useTheme();
  const sessionShort = currentSession ? currentSession.slice(0, 8) + '…' : 'NONE';

  return (
    <ScrollView
      style={{flex: 1, backgroundColor: palette.bg}}
      contentContainerStyle={{paddingBottom: 40}}>
      <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
        <Text style={type.label}>PROFILE</Text>

        <View style={{marginTop: spacing.lg}}>
          <Text style={[type.label, {color: palette.textDim}]}>USER</Text>
          <Text style={[type.displaySmall, {marginTop: 4, fontSize: 28, lineHeight: 32}]}>
            {config.username}
          </Text>
        </View>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.xl}} />

        <View style={{marginTop: spacing.lg}}>
          <Text style={type.label}>CONNECTION</Text>
          <Row label="HOST" value={`${config.host}:${config.port}`} />
          <Row label="USER" value={config.username} />
          <Row label="STATUS" value={serverOnline ? 'ONLINE' : 'OFFLINE'} accent={serverOnline ? palette.success : palette.error} last />
        </View>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.lg}} />

        <View style={{marginTop: spacing.lg}}>
          <Text style={type.label}>SESSION</Text>
          <Row label="ACTIVE" value={sessionShort} />
          <Row label="ENGINE" value={engineLabel} last />
        </View>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.lg}} />

        <View style={{marginTop: spacing.lg}}>
          <Text style={type.label}>CLIENT</Text>
          <Row label="VERSION" value="0.6.0" last />
        </View>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.lg}} />
        <Text style={[type.monoMuted, {marginTop: spacing.lg, textAlign: 'center', color: palette.textGhost}]}>
          ⎔ HERMES AGENT
        </Text>
      </View>
    </ScrollView>
  );
}

const Row: React.FC<{label: string; value: string; accent?: string; last?: boolean}> = ({label, value, accent, last}) => {
  const {palette, type} = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 12,
      borderTopWidth: last ? 0 : 1, borderTopColor: palette.border,
    }}>
      <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 11, width: 80}]}>
        {label}
      </Text>
      <Text style={[type.mono, {flex: 1, fontSize: 12, color: accent ?? palette.text}]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
};
