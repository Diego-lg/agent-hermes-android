/**
 * Settings tab. Theme-aware. Now includes an Appearance section for picking
 * one of the 6 design systems (Industrial, Brutalist, Soft Glass, Editorial,
 * Neon, Warm Clay).
 */
import React, {useEffect, useState} from 'react';
import {View, ScrollView, TouchableOpacity, Text, TextInput, Switch, Alert, Animated} from 'react-native';
import {useApp} from './AppContext';
import {Field} from './atoms';
import {useTheme, THEME_LIST, Theme, ThemeId} from './theme.tsx';
import {useThemeController} from './ThemeController';
import {AGENT_CATALOG} from '../agents/catalog';
import {ChevronRightIcon, EyeIcon, EyeOffIcon, CheckIcon} from './icons';
import {notesStore} from '../api/notesStore';
import {DriveConfig} from '../api/googleDrive';

export default function SettingsScreen() {
  const {config, setConfig, client, connect, disconnect, logout, setScreen} = useApp();
  const {palette, spacing, type, radii} = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(config);
  const [showPwd, setShowPwd] = useState(false);
  const [notifications, setNotifications] = useState(true);
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
    if (client) disconnect();
    await connect();
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

        <Section index="03" title="CLOUD — GOOGLE DRIVE">
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

        <Section index="04" title="PREFERENCES">
          <Row index="00" label="Notifications" value={notifications ? 'ON' : 'OFF'}
            right={<Switch value={notifications} onValueChange={setNotifications} trackColor={{true: palette.accent, false: palette.surfaceAlt}} thumbColor={palette.bg} />} />
          <Row index="01" label="Default Agent" value="NONE" onPress={() => setScreen('agents')} last />
        </Section>

        <Section index="05" title="ACCOUNT">
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
