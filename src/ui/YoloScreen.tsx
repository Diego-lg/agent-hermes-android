/**
 * YoloScreen — full YOLO / Independent mode settings panel.
 *
 * Lists every capability, lets the user flip the master switch and adjust
 * each row, and offers "GRANT ALL" to request every permission in one
 * step. Mirrored as a modal sheet from SettingsScreen and as a dedicated
 * route via the bottom nav (when active engine is the cloud one).
 *
 * Each row shows:
 *   - Capability icon + label + description
 *   - Current state (allowed / denied, OS-level GRANTED vs user toggle)
 *   - Per-row toggle (only meaningful when master YOLO is off)
 *   - Per-row "GRANT" button that calls PermissionsAndroid.request
 *
 * Persisted via the existing configStore path; we don't add a new key.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  View, ScrollView, TouchableOpacity, Text, Switch, Alert, Platform,
} from 'react-native';
import {useApp} from './AppContext';
import {useTheme} from './theme.tsx';
import {
  CAPABILITIES, Capability, CapabilityId,
  requestCapability, requestAll, getGrantedMap,
} from '../api/permissions';
import {YoloCapabilities} from '../api/configStore';
import {
  ChevronLeftIcon, ShieldCheckIcon, ShieldOffIcon, ShieldIcon, ZapIcon,
  GlobeIcon, FolderIcon, ImageIcon, CameraIcon, MicIcon, MapPinIcon,
  BellIcon, PhoneIcon, CalendarIcon, UserIcon,
} from './icons';

// Maps a capability to the icon used in the YOLO screen.
const ICON_FOR: Record<CapabilityId, any> = {
  internet: GlobeIcon,
  files: FolderIcon,
  photos: ImageIcon,
  camera: CameraIcon,
  microphone: MicIcon,
  location: MapPinIcon,
  notifications: BellIcon,
  contacts: UserIcon,
  calendar: CalendarIcon,
  phone: PhoneIcon,
};

export interface YoloScreenProps {
  /** Back nav (close modal). */
  onClose?: () => void;
  /** Compact = hide header & explainer (used from a bottom-sheet style modal). */
  compact?: boolean;
}

export default function YoloScreen({onClose, compact}: YoloScreenProps) {
  const {config, setConfig} = useApp();
  const {palette, spacing, type, radii} = useTheme();
  const yoloOn = !!config.yoloMode;
  const perCap: YoloCapabilities = {
    internet: true,
    files: !!config.yoloCapabilities?.files,
    photos: !!config.yoloCapabilities?.photos,
    camera: !!config.yoloCapabilities?.camera,
    microphone: !!config.yoloCapabilities?.microphone,
    location: !!config.yoloCapabilities?.location,
    notifications: !!config.yoloCapabilities?.notifications,
    contacts: !!config.yoloCapabilities?.contacts,
    calendar: !!config.yoloCapabilities?.calendar,
    phone: !!config.yoloCapabilities?.phone,
  };
  const [granted, setGranted] = useState<Record<CapabilityId, boolean>>({} as any);
  const [refreshing, setRefreshing] = useState(false);

  const refreshGranted = useCallback(async () => {
    try {
      const g = await getGrantedMap();
      setGranted(g);
    } catch {/* keep prior */}
  }, []);

  useEffect(() => { void refreshGranted(); }, [refreshGranted]);

  const setYolo = useCallback((on: boolean) => {
    setConfig({...config, yoloMode: on});
    if (on) {
      // When YOLO is on, every capability is "allowed" regardless of the
      // per-row override. We don't actively deny OS permissions — the
      // user can still flip each row off later; we just record the
      // intent. (On real Android, denying a granted permission requires
      // the OS Settings screen, which is one tap from the link below.)
    }
  }, [config, setConfig]);

  const setPerCap = useCallback((id: CapabilityId, on: boolean) => {
    setConfig({
      ...config,
      yoloCapabilities: {...(config.yoloCapabilities ?? {}), [id]: on},
    });
  }, [config, setConfig]);

  const onRequestOne = useCallback(async (cap: Capability) => {
    const ok = await requestCapability(cap.id);
    setGranted(prev => ({...prev, [cap.id]: ok}));
    if (!ok) {
      Alert.alert(
        'Permission denied',
        cap.id === 'files'
          ? 'Files access was denied. On Android 13+ the picker is per-file; the OS dialog may have been suppressed. You can still pick files via the paperclip button — Android will ask once per file.'
          : `Android refused the ${cap.label} permission. To grant it manually, open Settings → Apps → android-hermes → Permissions.`,
      );
    }
  }, []);

  const onRequestAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const g = await getGrantedMap();
      setGranted(g);
      const granted = Object.values(g).filter(Boolean).length;
      const total = Object.values(g).length;
      Alert.alert('YOLO granted', `${granted} / ${total} capabilities granted. You can fine-tune each row below.`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Description shown at top of the panel. Talks about YOLO being the
  // default for independent mode.
  const explainer = useMemo(() => (
    yoloOn
      ? 'Independent mode is fully unlocked. The agent can reach the internet, files, camera, mic, location, and notifications without asking again. You can still turn individual capabilities off below - for any you want locked, Android will need to be flipped in Settings > Apps > android-hermes > Permissions.'
      : 'Independent mode is locked. Only the rows you tick below are available to the agent. The internet is always on.'
  ), [yoloOn]);

  return (
    <View style={{flex: 1, backgroundColor: palette.bg}}>
      {!compact && (
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: spacing.lg, paddingTop: 18, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: palette.border,
        }}>
          <TouchableOpacity onPress={onClose} style={{padding: 4, marginRight: 8}}>
            <ChevronLeftIcon size={20} color={palette.textMuted} />
          </TouchableOpacity>
          <View style={{flex: 1}}>
            <Text style={[type.h2, {fontSize: 14, letterSpacing: 0.6}]}>
              INDEPENDENT · YOLO
            </Text>
            <Text style={[type.monoMuted, {fontSize: 10, marginTop: 2}]}>
              {CAPABILITIES.length} capabilities · {Object.values(granted).filter(Boolean).length} granted
            </Text>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={{paddingBottom: 80}}>
        {/* Master YOLO switch + explainer */}
        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.lg}}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            padding: spacing.md, borderRadius: radii.md,
            borderWidth: 1,
            borderColor: yoloOn ? palette.accent : palette.border,
            backgroundColor: yoloOn ? palette.accentMuted : palette.surfaceAlt,
          }}>
            <View style={{
              width: 36, height: 36, borderRadius: 18,
              backgroundColor: yoloOn ? palette.accent : palette.surface,
              borderWidth: 1, borderColor: yoloOn ? palette.accent : palette.border,
              alignItems: 'center', justifyContent: 'center',
              marginRight: spacing.md,
            }}>
              {yoloOn
                ? <ShieldCheckIcon size={18} color={palette.bg} />
                : <ShieldOffIcon size={18} color={palette.textMuted} />}
            </View>
            <View style={{flex: 1}}>
              <Text style={[type.h1, {fontSize: 16}]}>{yoloOn ? 'YOLO MODE ON' : 'YOLO MODE OFF'}</Text>
              <Text style={[type.body, {fontSize: 11, color: palette.textMuted, marginTop: 2}]}>
                {explainer}
              </Text>
            </View>
            <Switch
              value={yoloOn}
              onValueChange={setYolo}
              trackColor={{false: palette.border, true: palette.accent}}
              thumbColor={palette.bg}
            />
          </View>

          {/* Bulk action row */}
          <View style={{flexDirection: 'row', marginTop: spacing.md}}>
            <TouchableOpacity
              onPress={onRequestAll}
              disabled={refreshing}
              activeOpacity={0.7}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
                borderRadius: radii.sm,
                borderWidth: 1, borderColor: palette.accent,
                marginRight: spacing.sm,
              }}>
              <ZapIcon size={14} color={palette.accent} />
              <Text style={[type.h2, {color: palette.accent, fontSize: 12, marginLeft: 6}]}>
                {refreshing ? 'GRANTING…' : 'GRANT ALL'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void refreshGranted()}
              activeOpacity={0.6}
              style={{
                paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
                borderRadius: radii.sm, borderWidth: 1, borderColor: palette.border,
                alignItems: 'center', justifyContent: 'center',
              }}>
              <Text style={[type.h2, {color: palette.textMuted, fontSize: 12}]}>RECHECK</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{height: 1, backgroundColor: palette.border, marginTop: spacing.lg}} />

        {/* Per-capability rows */}
        {CAPABILITIES.map((cap, i) => {
          const Icon = ICON_FOR[cap.id];
          // Effective state: master YOLO on => allowed by default. Per-cap
          // override only matters when YOLO is off.
          const isOn = cap.id === 'internet' ? true : (yoloOn || perCap[cap.id]);
          const isGranted = !!granted[cap.id];
          // "Required" = when in YOLO mode the OS still needs to grant the
          // underlying runtime perm. If YOLO is on but Android hasn't
          // granted it yet, show a GRANT button.
          const showGrantButton = cap.id !== 'internet' && !!cap.androidPermissions?.length
            && (yoloOn || perCap[cap.id]) && !isGranted;
          return (
            <View key={cap.id}>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
              }}>
                <View style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: (isOn ? palette.accentMuted : palette.surfaceAlt),
                  borderWidth: 1,
                  borderColor: isOn ? palette.accent : palette.border,
                  alignItems: 'center', justifyContent: 'center',
                  marginRight: spacing.md,
                }}>
                  <Icon size={14} color={isOn ? palette.accent : palette.textMuted} />
                </View>
                <View style={{flex: 1}}>
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                    <Text style={[type.h2, {fontSize: 13, letterSpacing: 0.4, flex: 1}]}>
                      {cap.label.toUpperCase()}
                    </Text>
                    {cap.id === 'internet'
                      ? <Pill label="ALWAYS ON" color={palette.success} />
                      : (isOn && isGranted
                          ? <Pill label="GRANTED" color={palette.success} />
                          : isOn
                            ? <Pill label="NEEDS GRANT" color={palette.highlight} />
                            : <Pill label="OFF" color={palette.textDim} />)}
                  </View>
                  <Text style={[type.body, {color: palette.textMuted, fontSize: 11, marginTop: 2}]}
                    numberOfLines={3}>
                    {cap.description}
                  </Text>
                  {cap.androidPermissions?.length ? (
                    <Text style={[type.mono, {fontSize: 9, color: palette.textGhost, marginTop: 4}]}>
                      {cap.androidPermissions.join(' · ')}
                    </Text>
                  ) : null}
                </View>
                {cap.id !== 'internet' && (
                  <View style={{marginLeft: spacing.md, alignItems: 'flex-end'}}>
                    <Switch
                      value={isOn}
                      onValueChange={v => setPerCap(cap.id, v)}
                      trackColor={{false: palette.border, true: palette.accent}}
                      thumbColor={palette.bg}
                    />
                    {showGrantButton ? (
                      <TouchableOpacity
                        onPress={() => void onRequestOne(cap)}
                        style={{
                          marginTop: 6, paddingHorizontal: 8, paddingVertical: 4,
                          borderWidth: 1, borderColor: palette.highlight, borderRadius: radii.none,
                        }}>
                        <Text style={[type.h2, {color: palette.highlight, fontSize: 10}]}>GRANT</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )}
              </View>
              {i < CAPABILITIES.length - 1 ? (
                <View style={{
                  height: 1, backgroundColor: palette.border,
                  marginLeft: spacing.lg + 36, marginRight: spacing.lg,
                }} />
              ) : null}
            </View>
          );
        })}

        <View style={{paddingHorizontal: spacing.lg, paddingTop: spacing.xl}}>
          <Text style={[type.mono, {color: palette.textGhost, fontSize: 10}]}>
            Some Android permissions can't be requested inline — they require
            a one-time trip to Settings → Apps → android-hermes → Permissions.
            Use the GRANT button on each row; if Android refuses, that
            means the system needs you to confirm in the OS-level screen.
          </Text>
          {Platform.OS === 'ios'
            ? <Text style={[type.mono, {color: palette.textGhost, fontSize: 10, marginTop: 6}]}>
                iOS builds route these through NSPhotoLibraryUsageDescription et al in Info.plist — not yet wired.
              </Text>
            : null}
        </View>
      </ScrollView>
    </View>
  );
}

function Pill({label, color}: {label: string; color: string}) {
  const {palette, type} = useTheme();
  return (
    <View style={{
      paddingHorizontal: 6, paddingVertical: 2,
      borderWidth: 1, borderColor: color,
    }}>
      <Text style={[type.mono, {color, fontSize: 9, letterSpacing: 0.6}]}>{label}</Text>
    </View>
  );
}
