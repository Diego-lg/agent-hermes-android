/**
 * DiscoveredBanner — surfaces LAN-discovered Hermes instances on Home.
 *
 * UX rules:
 *   - Hidden entirely when there are no discoveries AND no recent scan.
 *   - Always-visible "refresh" icon so the user can re-scan manually.
 *   - Each host is a single tappable row: tap = switch + reconnect.
 *   - The currently-active host gets a check-mark and is non-tappable.
 *   - Scanning state has a small inline indicator on the title row.
 *
 * Compact: matches the YoloBanner styling.
 */
import React from 'react';
import {View, Text, TouchableOpacity, ScrollView} from 'react-native';
import {useTheme} from './theme.tsx';
import {ChevronRightIcon, RefreshIcon, CheckIcon, SearchIcon} from './icons';
import {DiscoveredHost} from '../api/lanDiscovery';

interface Props {
  hosts: DiscoveredHost[];
  loading: boolean;
  lastScanAt: number;
  activeHost: string;
  activePort: number;
  onRefresh: () => void;
  onSwitch: (host: string, port: number) => void;
}

function timeAgo(ts: number): string {
  const dt = Math.max(0, Date.now() - ts);
  if (dt < 1500) return 'just now';
  if (dt < 60_000) return `${Math.floor(dt / 1000)}s ago`;
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  return `${Math.floor(dt / 3_600_000)}h ago`;
}

export default function DiscoveredBanner({
  hosts,
  loading,
  lastScanAt,
  activeHost,
  activePort,
  onRefresh,
  onSwitch,
}: Props) {
  const {palette, type, spacing} = useTheme();

  // Empty state with no prior scan: show nothing (avoid noise on first run).
  if (hosts.length === 0 && !loading && lastScanAt === 0) return null;

  // Title row is always shown — if `loading`, the row itself acts as
  // the "scanning now" indicator; if we have results, the title shows
  // the count + last-scan timestamp.
  return (
    <View style={{
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: spacing.md, paddingVertical: 8,
        borderBottomWidth: hosts.length > 0 ? 1 : 0,
        borderBottomColor: palette.border,
      }}>
        <SearchIcon size={12} color={palette.accent} />
        <Text style={[type.label, {color: palette.accent, marginLeft: 6, flex: 1}]}>
          {loading
            ? 'SCANNING LAN…'
            : hosts.length === 0
              ? 'NO HERMES ON LAN'
              : `${hosts.length} HERMES ON LAN`}
        </Text>
        <Text style={[type.monoMuted, {color: palette.textGhost, fontSize: 9, marginRight: 8, fontVariant: ['tabular-nums']}]}>
          {loading ? '· · ·' : lastScanAt ? timeAgo(lastScanAt) : ''}
        </Text>
        <TouchableOpacity onPress={onRefresh} hitSlop={{top: 6, bottom: 6, left: 6, right: 6}} style={{padding: 4}}>
          <RefreshIcon size={12} color={palette.textDim} />
        </TouchableOpacity>
      </View>
      {hosts.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingVertical: 6, paddingHorizontal: 4}}>
          {hosts.map(h => {
            const isActive = h.host === activeHost && h.port === activePort;
            return (
              <TouchableOpacity
                key={`${h.host}:${h.port}`}
                onPress={isActive ? undefined : () => onSwitch(h.host, h.port)}
                activeOpacity={isActive ? 1 : 0.7}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: 4,
                  borderWidth: 1,
                  borderColor: isActive ? palette.accent : palette.border,
                  backgroundColor: isActive ? (palette.accentMuted ?? palette.surfaceAlt) : 'transparent',
                }}>
                {isActive ? (
                  <CheckIcon size={11} color={palette.accent} />
                ) : (
                  <ChevronRightIcon size={11} color={palette.textDim} />
                )}
                <Text style={[type.mono, {
                  color: isActive ? palette.accent : palette.text,
                  marginHorizontal: 6, fontSize: 11,
                }]}>
                  {h.host}
                </Text>
                <Text style={[type.monoMuted, {color: palette.textDim, fontSize: 9}]}>
                  {h.port} · {h.rtt}ms
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}
