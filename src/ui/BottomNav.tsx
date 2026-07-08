/**
 * BottomNav — theme-aware industrial layout.
 *
 * Reads palette / type / spacing from useTheme(). The active-indicator
 * style varies by theme (▬ underline, large numeral, gradient pill, etc.)
 * but the tab layout stays consistent.
 *
 * The 9 tabs:
 *   home · chat · sessions · models · agents · profiles · tasks · skills · workspace · memory · insights · settings
 *
 * We render the **core 6** in the nav row and surface the rest via a
 * "more" sheet (ellipsis icon) to keep the icon set readable on small phones.
 */
import React, {useEffect, useRef, useState} from 'react';
import {View, TouchableOpacity, Text, Animated, Modal, ScrollView} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useApp} from './AppContext';
import {useTheme, Theme} from './theme.tsx';
import {
  HomeIcon, HomeFilled, MessageIcon, MessageFilled,
  BotIcon, BotFilled, SettingsIcon, SettingsFilled, UserIcon, UserFilled,
  FileTextIcon, ClockIcon, ChevronRightIcon, RefreshIcon, HashIcon,
  CpuIcon, LayersIcon, BookmarkIcon, FolderIcon, DatabaseIcon,
  ChartBarIcon, ServerIcon, XIcon,
} from './icons';

export type Tab =
  | 'home' | 'chat' | 'sessions' | 'models' | 'agents' | 'profiles'
  | 'tasks' | 'skills' | 'workspace' | 'memory' | 'insights' | 'settings';

interface BottomNavProps {
  active: Tab;
  onChange: (t: Tab) => void;
  hasSession?: boolean;
  notesReady?: boolean;
}

interface TabDef {
  id: Tab;
  label: string;
  Icon: any;
  IconActive: any;
}

const PRIMARY_TABS: TabDef[] = [
  {id: 'home',      label: 'HOME',      Icon: HomeIcon,     IconActive: HomeFilled},
  {id: 'chat',      label: 'CHAT',      Icon: MessageIcon,  IconActive: MessageFilled},
  {id: 'sessions',  label: 'SESSIONS',  Icon: ClockIcon,    IconActive: ClockIcon},
  {id: 'models',    label: 'MODELS',    Icon: CpuIcon,      IconActive: CpuIcon},
  {id: 'tasks',     label: 'TASKS',     Icon: RefreshIcon,  IconActive: RefreshIcon},
];

const MORE_TABS: TabDef[] = [
  {id: 'agents',    label: 'AGENTS',    Icon: BotIcon,        IconActive: BotFilled},
  {id: 'profiles',  label: 'PROFILES',  Icon: LayersIcon,     IconActive: LayersIcon},
  {id: 'skills',    label: 'SKILLS',    Icon: HashIcon,       IconActive: HashIcon},
  {id: 'workspace', label: 'WORKSPACE', Icon: FolderIcon,     IconActive: FolderIcon},
  {id: 'memory',    label: 'MEMORY',    Icon: DatabaseIcon,   IconActive: DatabaseIcon},
  {id: 'insights',  label: 'INSIGHTS',  Icon: ChartBarIcon,   IconActive: ChartBarIcon},
  {id: 'settings',  label: 'SETTINGS',  Icon: SettingsIcon,   IconActive: SettingsFilled},
];

const ActiveIndicator: React.FC<{
  index: number;
  count: number;
  theme: Theme;
}> = ({index, count, theme}) => {
  const {palette} = theme;
  const x = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    Animated.spring(x, {toValue: index, friction: 9, tension: 100, useNativeDriver: true}).start();
  }, [index, x]);
  const tabW = 100 / count;
  const xPct = x.interpolate({inputRange: [0, count - 1], outputRange: [tabW / 2, 100 - tabW / 2], extrapolate: 'clamp'});
  const txX = xPct.interpolate({inputRange: [0, 100], outputRange: [-50, 50]});

  if (theme.id === 'brutalist') {
    return (
      <View style={{height: 4, width: 24, marginBottom: 4, justifyContent: 'center', alignItems: 'center'}}>
        <View style={{height: 4, width: 24, backgroundColor: palette.accent}} />
      </View>
    );
  }
  if (theme.id === 'softGlass') {
    return (
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 4, left: `${tabW / 2}%`,
          width: 40, height: 28, borderRadius: 14,
          backgroundColor: palette.accentMuted,
          borderWidth: 1, borderColor: palette.accent,
          transform: [{translateX: txX}, {translateX: -20}],
        }}
      />
    );
  }
  return (
    <View style={{height: 2, width: 24, marginBottom: 6, justifyContent: 'center'}}>
      <View style={{height: 2, width: 16, backgroundColor: palette.accent, alignSelf: 'center'}} />
    </View>
  );
};

export const BottomNav: React.FC<BottomNavProps> = ({active, onChange, hasSession, notesReady}) => {
  const theme = useTheme();
  const {palette, type} = theme;
  const [moreOpen, setMoreOpen] = useState(false);
  const activeIdx = Math.max(0, PRIMARY_TABS.findIndex(t => t.id === active));

  // If the active tab is in MORE_TABS, highlight the "More" slot at the end.
  const isMoreActive = MORE_TABS.some(t => t.id === active);

  const handleMoreItem = (id: Tab) => {
    setMoreOpen(false);
    onChange(id);
  };

  return (
    <SafeAreaView edges={['bottom']} style={{backgroundColor: palette.bg}}>
      <View style={{
        backgroundColor: palette.bg,
        borderTopWidth: theme.id === 'softGlass' ? 0 : 1,
        borderTopColor: palette.border,
        paddingTop: 8, paddingBottom: 8,
      }}>
        {theme.id === 'softGlass' ? (
          <View style={{position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: palette.border}} />
        ) : null}
        <View style={{flexDirection: 'row'}}>
          {PRIMARY_TABS.map((t, idx) => {
            const isActive = active === t.id;
            const IconCmp = isActive ? t.IconActive : t.Icon;
            const iconColor = isActive ? palette.accent : palette.textDim;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => onChange(t.id)}
                activeOpacity={0.6}
                style={{flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4}}>
                <ActiveIndicator index={idx} count={PRIMARY_TABS.length + 1} theme={theme} />
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

          {/* More slot */}
          <TouchableOpacity
            onPress={() => setMoreOpen(true)}
            activeOpacity={0.6}
            style={{flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4}}>
            <ActiveIndicator index={PRIMARY_TABS.length} count={PRIMARY_TABS.length + 1} theme={theme} />
            <View style={{position: 'relative'}}>
              <ServerIcon size={22} color={isMoreActive ? palette.accent : palette.textDim} />
            </View>
            <Text style={[type.mono, {
              fontSize: 9, marginTop: 4,
              color: isMoreActive ? palette.accent : palette.textMuted,
              letterSpacing: 0.4, fontWeight: '600',
            }]}>
              MORE
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={moreOpen} animationType="slide" transparent onRequestClose={() => setMoreOpen(false)}>
        <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'}}>
          <View style={{
            backgroundColor: palette.bg,
            borderTopWidth: 1, borderColor: palette.border,
            maxHeight: '80%',
          }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
              borderBottomWidth: 1, borderBottomColor: palette.border,
            }}>
              <Text style={[type.h2, {flex: 1, fontSize: 13, letterSpacing: 0.5}]}>MORE</Text>
              <TouchableOpacity onPress={() => setMoreOpen(false)} style={{padding: 6}}>
                <XIcon size={18} color={palette.textDim} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{paddingBottom: 24}}>
              {MORE_TABS.map(t => {
                const IconCmp = t.id === active ? t.IconActive : t.Icon;
                const isActive = active === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => handleMoreItem(t.id)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: 18, paddingVertical: 14,
                      borderBottomWidth: 1, borderBottomColor: palette.border,
                      backgroundColor: isActive ? (palette.accentMuted ?? 'transparent') : 'transparent',
                    }}>
                    <IconCmp size={18} color={isActive ? palette.accent : palette.textDim} filled={isActive} />
                    <Text style={[type.body, {flex: 1, marginLeft: 14, color: isActive ? palette.accent : palette.text, fontSize: 14}]}>
                      {t.label}
                    </Text>
                    <ChevronRightIcon size={14} color={palette.textDim} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};
