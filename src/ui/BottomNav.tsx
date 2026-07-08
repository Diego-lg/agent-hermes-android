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
import {HomeIcon, HomeFilled, MessageIcon, MessageFilled, BotIcon, BotFilled, SettingsIcon, SettingsFilled, UserIcon, UserFilled} from './icons';

export type Tab = 'home' | 'chat' | 'agents' | 'settings' | 'profile';

interface BottomNavProps {
  active: Tab;
  onChange: (t: Tab) => void;
  hasSession?: boolean;
}

const TABS: Array<{id: Tab; label: string; Icon: any; IconActive: any}> = [
  {id: 'home',     label: 'HOME',     Icon: HomeIcon,     IconActive: HomeFilled},
  {id: 'chat',     label: 'CHAT',     Icon: MessageIcon,  IconActive: MessageFilled},
  {id: 'agents',   label: 'AGENTS',   Icon: BotIcon,      IconActive: BotFilled},
  {id: 'settings', label: 'SETTINGS', Icon: SettingsIcon, IconActive: SettingsFilled},
  {id: 'profile',  label: 'PROFILE',  Icon: UserIcon,     IconActive: UserFilled},
];

export const BottomNav: React.FC<BottomNavProps> = ({active, onChange, hasSession}) => {
  const activeIdx = TABS.findIndex(t => t.id === active);
  const indicatorX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(indicatorX, {
      toValue: activeIdx,
      friction: 9,
      tension: 100,
      useNativeDriver: true,
    }).start();
  }, [activeIdx, indicatorX]);

  return (
    <View style={{
      backgroundColor: palette.bg,
      borderTopWidth: 1,
      borderTopColor: palette.hairline,
      paddingTop: 8,
      paddingBottom: 20,
    }}>
      <View style={{flexDirection: 'row'}}>
        {TABS.map((t, idx) => {
          const isActive = active === t.id;
          const IconCmp = isActive ? t.IconActive : t.Icon;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => onChange(t.id)}
              activeOpacity={0.6}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 4,
              }}>
              {/* ▬ indicator above icon, only on active */}
              <View style={{height: 2, width: 24, marginBottom: 6, justifyContent: 'center'}}>
                {isActive ? (
                  <View style={{
                    height: 2, width: 16, backgroundColor: palette.on, alignSelf: 'center',
                  }} />
                ) : null}
              </View>
              <View style={{position: 'relative'}}>
                <IconCmp
                  size={22}
                  color={isActive ? palette.on : palette.textDim}
                  filled={isActive}
                />
                {t.id === 'chat' && hasSession ? (
                  <View style={{
                    position: 'absolute', top: -1, right: -3,
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: palette.active,
                  }} />
                ) : null}
              </View>
              {/* index numeral */}
              <Text style={[
                type.mono,
                {
                  fontSize: 9,
                  marginTop: 4,
                  color: isActive ? palette.on : palette.textDim,
                  letterSpacing: 0,
                  fontWeight: '600',
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
