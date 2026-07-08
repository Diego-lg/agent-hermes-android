/**
 * YoloBanner — one-line pill that lives under the engine status row.
 *
 * Shows:
 *   - "YOLO · 7/10" when master YOLO is on (n granted)
 *   - "YOLO OFF · 3/10" when master is off
 *   - Tap to expand into the full YoloScreen modal
 *
 * Keeps the user aware of what the agent can touch without them having
 * to dig into Settings.
 */
import React, {useEffect, useState, useCallback} from 'react';
import {TouchableOpacity, View, Text} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {ShieldCheckIcon, ShieldOffIcon, ChevronRightIcon} from './icons';
import {
  CAPABILITIES, getGrantedMap,
} from '../api/permissions';

export default function YoloBanner({onPress}: {onPress: () => void}) {
  const {config} = useApp();
  const {palette, spacing, type} = useTheme();
  const yoloOn = !!config.yoloMode;
  // Counts: how many capabilities the user has allowed (YOLO=on => all;
  // YOLO=off => per-cap true). And separately how many the OS has
  // actually granted.
  const total = CAPABILITIES.length;
  const allowedCount = yoloOn
    ? total
    : CAPABILITIES.filter(c => c.id === 'internet' || !!config.yoloCapabilities?.[c.id]).length;
  const [grantedCount, setGrantedCount] = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      const g = await getGrantedMap();
      setGrantedCount(Object.values(g).filter(Boolean).length);
    } catch {/* fine */}
  }, []);

  useEffect(() => { void refresh(); }, [refresh, config.yoloMode, config.yoloCapabilities]);

  const Icon = yoloOn ? ShieldCheckIcon : ShieldOffIcon;
  const tone = yoloOn
    ? (grantedCount === total ? palette.success
        : grantedCount >= total / 2 ? palette.highlight
        : palette.error)
    : palette.textMuted;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 8, paddingHorizontal: spacing.sm,
        marginTop: 4, marginBottom: spacing.md,
        borderWidth: 1, borderColor: tone,
        backgroundColor: yoloOn ? palette.surface : 'transparent',
      }}>
      <Icon size={14} color={tone} />
      <View style={{marginLeft: 8, flex: 1, flexDirection: 'row', alignItems: 'center'}}>
        <Text style={[type.label, {color: tone, fontSize: 10}]}>
          {yoloOn ? 'YOLO' : 'YOLO OFF'}
        </Text>
        <View style={{
          width: 1, height: 10, backgroundColor: palette.border, marginHorizontal: spacing.sm,
        }} />
        <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 10, flex: 1}]}
          numberOfLines={1}>
          {yoloOn ? `${grantedCount}/${total} granted · all capabilities on` : `${allowedCount}/${total} on`}
        </Text>
      </View>
      <ChevronRightIcon size={12} color={palette.textDim} />
    </TouchableOpacity>
  );
}
