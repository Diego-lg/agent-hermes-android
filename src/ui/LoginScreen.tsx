/**
 * Login screen. Theme-aware.
 */
import React, {useEffect, useState} from 'react';
import {View, KeyboardAvoidingView, Platform, Text, TouchableOpacity, TextInput} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ArrowUpRightIcon, EyeIcon, EyeOffIcon} from './icons';

export default function LoginScreen() {
  const {config, setConfig, connect, connecting, connectionError} = useApp();
  const {palette, spacing, type} = useTheme();
  // Seed draft from the live config whenever it changes. Without this,
  // the saved API key / host / port / username load async on app start
  // (see AppProvider's load effect) and the form would keep showing the
  // hardcoded default until the user manually re-types it.
  const [draft, setDraft] = useState(config);
  useEffect(() => { setDraft(config); }, [config]);
  const [showPwd, setShowPwd] = useState(false);
  const monoFont = Platform.select({ios: 'Menlo', android: 'monospace'});

  const onSubmit = () => {
    setConfig(draft);
    void connect();
  };

  return (
    <KeyboardAvoidingView
      style={{flex: 1, backgroundColor: palette.bg, justifyContent: 'center'}}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{paddingHorizontal: spacing.xl}}>
        <Text style={type.label}>HERMES AGENT</Text>
        <View style={{height: 1, width: 32, backgroundColor: palette.accent, marginTop: spacing.sm, marginBottom: spacing.lg}} />

        <Text style={type.label}>USER</Text>
        <TextInput
          value={draft.username}
          onChangeText={v => setDraft({...draft, username: v})}
          autoCapitalize="none"
          placeholder="diego"
          placeholderTextColor={palette.textGhost}
          style={{
            color: palette.text, fontSize: 22, fontWeight: '600',
            letterSpacing: -0.5, paddingVertical: 8,
            borderBottomWidth: 1, borderBottomColor: palette.border,
          }}
        />

        <View style={{height: spacing.xl}} />

        <Text style={type.label}>HOST</Text>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <TextInput
            value={draft.host}
            onChangeText={v => setDraft({...draft, host: v})}
            autoCapitalize="none"
            placeholder="192.168.18.54"
            placeholderTextColor={palette.textGhost}
            keyboardType="numbers-and-punctuation"
            style={{
              flex: 1, color: palette.text, fontSize: 18, fontFamily: monoFont,
              paddingVertical: 8,
              borderBottomWidth: 1, borderBottomColor: palette.border,
            }}
          />
          <Text style={[type.mono, {color: palette.textDim, marginLeft: 8}]}>:</Text>
          <TextInput
            value={String(draft.port)}
            onChangeText={v => setDraft({...draft, port: parseInt(v, 10) || 9119})}
            keyboardType="number-pad"
            style={{
              width: 70, color: palette.text, fontSize: 18, textAlign: 'right',
              fontFamily: monoFont,
              paddingVertical: 8,
              borderBottomWidth: 1, borderBottomColor: palette.border,
            }}
          />
        </View>

        <View style={{height: spacing.xl}} />

        <Text style={type.label}>PASSWORD</Text>
        <View style={{flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border}}>
          <Text style={[type.mono, {color: palette.textMuted, marginRight: 8}]}>›</Text>
          <TextInput
            value={draft.password}
            onChangeText={v => setDraft({...draft, password: v})}
            secureTextEntry={!showPwd}
            autoCapitalize="none"
            placeholder="••••••••"
            placeholderTextColor={palette.textGhost}
            style={{
              flex: 1, color: palette.text, fontSize: 16, fontFamily: monoFont,
              paddingVertical: 8,
            }}
          />
          <TouchableOpacity onPress={() => setShowPwd(s => !s)} style={{padding: 8}}>
            {showPwd
              ? <EyeOffIcon size={16} color={palette.textMuted} />
              : <EyeIcon size={16} color={palette.textMuted} />}
          </TouchableOpacity>
        </View>

        {connectionError ? (
          <View style={{
            borderLeftWidth: 2, borderLeftColor: palette.error,
            paddingLeft: spacing.md, marginTop: spacing.lg,
          }}>
            <Text style={[type.label, {color: palette.error}]}>CONNECTION FAILED</Text>
            <Text style={[type.monoMuted, {color: palette.textMuted, marginTop: 4, fontSize: 11}]}>
              {connectionError}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={onSubmit}
          disabled={connecting || !draft.password}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: palette.accent,
            padding: spacing.lg,
            marginTop: spacing.xxl,
            opacity: connecting || !draft.password ? 0.4 : 1,
          }}>
          <Text style={[type.h2, {color: palette.bg, fontSize: 13, letterSpacing: 1.5}]}>
            {connecting ? 'CONNECTING' : 'CONNECT'}
          </Text>
          <ArrowUpRightIcon size={20} color={palette.bg} />
        </TouchableOpacity>

        <View style={{marginTop: spacing.xl, alignItems: 'center'}}>
          <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 10}]}>
            LAN ONLY  ·  CLEARTEXT  ·  LOCAL
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};
