/**
 * BottomNav — theme-aware industrial layout.
 *
 * Reads palette / type / spacing from useTheme(). The active-indicator
 * style varies by theme (▬ underline, large numeral, gradient pill, etc.)
 * but the tab layout stays consistent.
 */
import React, {useEffect, useRef} from 'react';
import {View, TouchableOpacity, Text, Animated} from 'react-native';
import {useTheme, Theme} from './theme.tsx';
import {
  HomeIcon, HomeFilled, MessageIcon, MessageFilled, BotIcon, BotFilled,
  SettingsIcon, SettingsFilled, UserIcon, UserFilled, FileTextIcon, ClockIcon,
} from './icons';

export type Tab = 'home' | 'chat' | 'agents' | 'settings' | 'profile' | 'notes' | 'cron';

interface BottomNavProps {
  active: Tab;
  onChange: (t: Tab) => void;
  hasSession?: boolean;
  notesReady?: boolean;
}

const TABS: Array<{id: Tab; label: string; Icon: any; IconActive: any}> = [
  {id: 'home',     label: 'HOME',     Icon: HomeIcon,     IconActive: HomeFilled},
  {id: 'notes',    label: 'NOTES',    Icon: FileTextIcon, IconActive: FileTextIcon},
  {id: 'chat',     label: 'CHAT',     Icon: MessageIcon,  IconActive: MessageFilled},
  {id: 'cron',     label: 'CRON',     Icon: ClockIcon,    IconActive: ClockIcon},
  {id: 'settings', label: 'SETTINGS', Icon: SettingsIcon, IconActive: SettingsFilled},
];

const ActiveIndicator: React.FC<{
  index: number;
  count: number;
  theme: Theme;
}> = ({index, count, theme}) => {
  const {palette, spacing, type, radii} = theme;
  const x = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.spring(x, {toValue: index, friction: 9, tension: 100, useNativeDriver: true}).start();
  }, [index, x]);

  const tabW = 100 / count;
  const xPct = x.interpolate({inputRange: [0, count - 1], outputRange: [tabW / 2, 100 - tabW / 2], extrapolate: 'clamp'});
  const txX = xPct.interpolate({inputRange: [0, 100], outputRange: [-50, 50]});

  if (theme.id === 'brutalist') {
    // Oversized numeral under the icon
    return (
      <View style={{height: 4, width: 24, marginBottom: 4, justifyContent: 'center', alignItems: 'center'}}>
        <View style={{height: 4, width: 24, backgroundColor: palette.accent}} />
      </View>
    );
  }

  if (theme.id === 'softGlass') {
    // Filled gradient pill
    return (
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 4,
          left: `${tabW / 2}%`,
          width: 40, height: 28, borderRadius: 14,
          backgroundColor: palette.accentMuted,
          borderWidth: 1, borderColor: palette.accent,
          transform: [{translateX: txX}, {translateX: -20}],
        }}
      />
    );
  }

  if (theme.id === 'editorial') {
    // Thin underline accent
    return (
      <View style={{height: 2, width: 24, marginBottom: 6, justifyContent: 'center', alignItems: 'center'}}>
        <View style={{height: 2, width: 16, backgroundColor: palette.accent}} />
      </View>
    );
  }

  if (theme.id === 'neon') {
    // Glowing dot
    return (
      <View style={{
        height: 4, width: 24, marginBottom: 6, justifyContent: 'center', alignItems: 'center',
      }}>
        <View style={{
          width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent,
          shadowColor: palette.accent, shadowOpacity: 1, shadowRadius: 6, shadowOffset: {width: 0, height: 0},
        }} />
      </View>
    );
  }

  if (theme.id === 'warmClay') {
    // Simple underline
    return (
      <View style={{height: 2, width: 24, marginBottom: 6, justifyContent: 'center', alignItems: 'center'}}>
        <View style={{height: 2, width: 20, backgroundColor: palette.accent}} />
      </View>
    );
  }

  // Industrial: ▬ underline
  return (
    <View style={{height: 2, width: 24, marginBottom: 6, justifyContent: 'center'}}>
      <View style={{height: 2, width: 16, backgroundColor: palette.on ?? palette.accent, alignSelf: 'center'}} />
    </View>
  );
};

export const BottomNav: React.FC<BottomNavProps> = ({active, onChange, hasSession, notesReady}) => {
  const theme = useTheme();
  const {palette, spacing, type} = theme;
  const visibleTabs = TABS.filter(t => !(t.id === 'notes' && !notesReady));
  const activeIdx = Math.max(0, visibleTabs.findIndex(t => t.id === active));

  return (
    <View style={{
      backgroundColor: palette.bg,
      borderTopWidth: theme.id === 'softGlass' ? 0 : 1,
      borderTopColor: palette.border,
      paddingTop: 8, paddingBottom: 20,
    }}>
      {theme.id === 'softGlass' ? (
        // Frosted top edge for glass theme
        <View style={{position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: palette.border}} />
      ) : null}
      <View style={{flexDirection: 'row'}}>
        {visibleTabs.map((t, idx) => {
          const isActive = active === t.id;
          const IconCmp = isActive ? t.IconActive : t.Icon;
          const iconColor = isActive ? palette.accent : palette.textDim;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => onChange(t.id)}
              activeOpacity={0.6}
              style={{flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4}}>
              <ActiveIndicator index={idx} count={visibleTabs.length} theme={theme} />
              <View style={{position: 'relative'}}>
                <IconCmp size={22} color={iconColor} filled={isActive} />
                {t.id === 'chat' && hasSession ? (
                  <View style={{
                    position: 'absolute', top: -1, right: -3,
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: palette.success,
                  }} />
                ) : null}
              </View>
              <Text style={[
                type.mono,
                {
                  fontSize: 9, marginTop: 4,
                  color: isActive ? palette.accent : palette.textMuted,
                  letterSpacing: 0.4, fontWeight: '600',
                },
              ]}>
                {String(idx).padStart(2, '0')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};
