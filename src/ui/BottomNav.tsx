/**
 * BottomNav — industrial layout.
 *
 * - No background fill; sits on pure #000
 * - 1px hairline divider on top
 * - ▬ indicator above the active icon (not a pill)
 * - Index numerals under each icon (0..4) in tabular mono
 * - Icon flips to filled white when active, dim grey when not
 */
import React, {useEffect, useRef} from 'react';
import {View, TouchableOpacity, Text, Animated} from 'react-native';
import {palette, spacing, type} from './theme';
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

const TABS: Array<{id: Tab; label: string; Icon: any; IconActive: any; hidden?: boolean}> = [
  {id: 'home',     label: 'HOME',     Icon: HomeIcon,     IconActive: HomeFilled},
  {id: 'notes',    label: 'NOTES',    Icon: FileTextIcon, IconActive: FileTextIcon},
  {id: 'chat',     label: 'CHAT',     Icon: MessageIcon,  IconActive: MessageFilled},
  {id: 'cron',     label: 'CRON',     Icon: ClockIcon,    IconActive: ClockIcon},
  {id: 'settings', label: 'SETTINGS', Icon: SettingsIcon, IconActive: SettingsFilled},
];

export const BottomNav: React.FC<BottomNavProps> = ({active, onChange, hasSession, notesReady}) => {
  const visibleTabs = TABS.filter(t => !(t.id === 'notes' && !notesReady));
  const activeIdx = Math.max(0, visibleTabs.findIndex(t => t.id === active));
  const indicatorX = useRef(new Animated.Value(activeIdx)).current;

  useEffect(() => {
    Animated.spring(indicatorX, {
      toValue: activeIdx,
      friction: 9, tension: 100, useNativeDriver: true,
    }).start();
  }, [activeIdx, indicatorX]);

  return (
    <View style={{
      backgroundColor: palette.bg,
      borderTopWidth: 1, borderTopColor: palette.hairline,
      paddingTop: 8, paddingBottom: 20,
    }}>
      <View style={{flexDirection: 'row'}}>
        {visibleTabs.map((t, idx) => {
          const isActive = active === t.id;
          const IconCmp = isActive ? t.IconActive : t.Icon;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => onChange(t.id)}
              activeOpacity={0.6}
              style={{flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4}}>
              <View style={{height: 2, width: 24, marginBottom: 6, justifyContent: 'center'}}>
                {isActive ? (
                  <View style={{height: 2, width: 16, backgroundColor: palette.on, alignSelf: 'center'}} />
                ) : null}
              </View>
              <View style={{position: 'relative'}}>
                <IconCmp size={22} color={isActive ? palette.on : palette.textDim} filled={isActive} />
                {t.id === 'chat' && hasSession ? (
                  <View style={{
                    position: 'absolute', top: -1, right: -3,
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: palette.active,
                  }} />
                ) : null}
              </View>
              <Text style={[
                type.mono,
                {
                  fontSize: 9, marginTop: 4,
                  color: isActive ? palette.on : palette.textDim,
                  letterSpacing: 0, fontWeight: '600',
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
