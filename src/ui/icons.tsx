/**
 * Hand-rolled Lucide-style icon components.
 *
 * 1.5px stroke, currentColor, square 24×24 by default. Sized via `size` prop.
 * No npm dependency, no font, no SVG sprite — just plain React Native
 * <Path>/<Circle>/<Line> components from react-native-svg.
 *
 * Naming mirrors the Lucide set so it's obvious which icon is which when
 * you go looking. The set is intentionally narrow — only the icons we
 * actually use in the app.
 */
import React from 'react';
import {View} from 'react-native';
import Svg, {Path, Circle, Line, Polyline, Polygon, Rect, G} from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
}

const base = (size: number, color: string, sw: number, filled: boolean): any => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: filled ? color : 'none',
  stroke: filled ? 'none' : color,
  strokeWidth: sw,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

const wrap = (children: React.ReactNode) =>
  ({children}: {children: React.ReactNode}) => <>{children}</>;

const make = (paths: React.ReactNode) => {
  const C: React.FC<IconProps> = ({size = 22, color = '#e8eaed', strokeWidth = 1.6, filled = false}) => (
    <Svg {...base(size, color, strokeWidth, filled)}>{paths}</Svg>
  );
  return C;
};

/* ---------- Navigation / UI ---------- */

export const HomeIcon = make(
  <>
    <Path d="M3 10.5 12 3l9 7.5" />
    <Path d="M5 10v10h14V10" />
  </>,
);
export const HomeFilled = make(<Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />);

export const MessageIcon = make(
  <>
    <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  </>,
);
export const MessageFilled = make(
  <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />,
);

export const BotIcon = make(
  <>
    <Path d="M12 8V4H8" />
    <Rect x="2" y="8" width="20" height="12" rx="2" />
    <Path d="M2 14h20" />
    <Path d="M6 18v2" />
    <Path d="M18 18v2" />
    <Circle cx="8" cy="14" r="0.6" fill="currentColor" />
    <Circle cx="16" cy="14" r="0.6" fill="currentColor" />
  </>,
);
export const BotFilled = make(
  <Path d="M12 2a1 1 0 0 1 1 1v3h3a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-9a2 2 0 0 1 2-2h2V7a1 1 0 0 1 1-1h3V3a1 1 0 0 1 1-1z" />,
);

export const SettingsIcon = make(
  <>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.16.77.16 1.13 0H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);
export const SettingsFilled = make(
  <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.16.77.16 1.13 0H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />,
);
export const UserFilled = make(
  <>
    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </>,
);

export const UserIcon = make(
  <>
    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </>,
);

/* ---------- Actions ---------- */

export const PlusIcon = make(
  <>
    <Line x1="12" y1="5" x2="12" y2="19" />
    <Line x1="5" y1="12" x2="19" y2="12" />
  </>,
);

export const SendIcon = make(
  <>
    <Line x1="22" y1="2" x2="11" y2="13" />
    <Polygon points="22 2 15 22 11 13 2 9 22 2" />
  </>,
);

export const StopIcon = make(<Rect x="5" y="5" width="14" height="14" rx="2" />);

export const MicIcon = make(
  <>
    <Rect x="9" y="2" width="6" height="12" rx="3" />
    <Path d="M5 10a7 7 0 0 0 14 0" />
    <Line x1="12" y1="17" x2="12" y2="22" />
  </>,
);

export const MicOffIcon = make(
  <>
    <Line x1="2" y1="2" x2="22" y2="22" />
    <Path d="M18.89 13.23A7 7 0 0 0 19 12v-2" />
    <Path d="M5 10v2a7 7 0 0 0 12 5" />
    <Path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
    <Path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
    <Line x1="12" y1="17" x2="12" y2="22" />
  </>,
);

export const XIcon = make(
  <>
    <Line x1="18" y1="6" x2="6" y2="18" />
    <Line x1="6" y1="6" x2="18" y2="18" />
  </>,
);

export const CheckIcon = make(<Polyline points="20 6 9 17 4 12" />);

export const ChevronLeftIcon = make(<Polyline points="15 18 9 12 15 6" />);
export const ChevronRightIcon = make(<Polyline points="9 18 15 12 9 6" />);
export const PlayIcon = make(<Polygon points="6 3 20 12 6 21 6 3" />);
export const SaveIcon = make(
  <>
    <Path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <Polyline points="17 21 17 13 7 13 7 21" />
    <Polyline points="7 3 7 8 15 8" />
  </>,
);
export const ArrowUpRightIcon = make(
  <>
    <Line x1="7" y1="17" x2="17" y2="7" />
    <Polyline points="7 7 17 7 17 17" />
  </>,
);

export const CopyIcon = make(
  <>
    <Rect x="9" y="9" width="13" height="13" rx="2" />
    <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);

export const EditIcon = make(
  <>
    <Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
  </>,
);

export const TrashIcon = make(
  <>
    <Polyline points="3 6 5 6 21 6" />
    <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <Path d="M10 11v6" />
    <Path d="M14 11v6" />
    <Path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </>,
);

export const RefreshIcon = make(
  <>
    <Polyline points="23 4 23 10 17 10" />
    <Polyline points="1 20 1 14 7 14" />
    <Path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
    <Path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </>,
);

/* ---------- Domain ---------- */

export const TerminalIcon = make(
  <>
    <Polyline points="4 17 10 11 4 5" />
    <Line x1="12" y1="19" x2="20" y2="19" />
  </>,
);

export const CodeIcon = make(
  <>
    <Polyline points="16 18 22 12 16 6" />
    <Polyline points="8 6 2 12 8 18" />
  </>,
);

export const SearchIcon = make(
  <>
    <Circle cx="11" cy="11" r="8" />
    <Line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>,
);

export const Edit3Icon = make(
  <>
    <Path d="M12 20h9" />
    <Path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
  </>,
);

export const PenIcon = make(
  <>
    <Path d="M12 19l7-7 3 3-7 7-3-3z" />
    <Path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z" />
    <Path d="M2 2l7.586 7.586" />
    <Circle cx="11" cy="11" r="2" />
  </>,
);

export const BarChartIcon = make(
  <>
    <Line x1="12" y1="20" x2="12" y2="10" />
    <Line x1="18" y1="20" x2="18" y2="4" />
    <Line x1="6" y1="20" x2="6" y2="16" />
  </>,
);

export const HomeHouseIcon = make(
  <>
    <Path d="M3 9.5L12 2l9 7.5V20a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z" />
  </>,
);

export const CpuIcon = make(
  <>
    <Rect x="4" y="4" width="16" height="16" rx="2" />
    <Rect x="9" y="9" width="6" height="6" />
    <Line x1="9" y1="2" x2="9" y2="4" />
    <Line x1="15" y1="2" x2="15" y2="4" />
    <Line x1="9" y1="20" x2="9" y2="22" />
    <Line x1="15" y1="20" x2="15" y2="22" />
    <Line x1="20" y1="9" x2="22" y2="9" />
    <Line x1="20" y1="15" x2="22" y2="15" />
    <Line x1="2" y1="9" x2="4" y2="9" />
    <Line x1="2" y1="15" x2="4" y2="15" />
  </>,
);

export const LightbulbIcon = make(
  <>
    <Path d="M9 18h6" />
    <Path d="M10 22h4" />
    <Path d="M15.09 14a4 4 0 1 0-6.18 0" />
  </>,
);

/* ---------- Settings ---------- */

export const GlobeIcon = make(
  <>
    <Circle cx="12" cy="12" r="10" />
    <Line x1="2" y1="12" x2="22" y2="12" />
    <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </>,
);

export const LockIcon = make(
  <>
    <Rect x="3" y="11" width="18" height="11" rx="2" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);

export const BellIcon = make(
  <>
    <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <Path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </>,
);

export const ImageIcon = make(
  <>
    <Rect x="3" y="3" width="18" height="18" rx="2" />
    <Circle cx="8.5" cy="8.5" r="1.5" />
    <Polyline points="21 15 16 10 5 21" />
  </>,
);

export const FileIcon = make(
  <>
    <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <Polyline points="14 2 14 8 20 8" />
  </>,
);

export const ClockIcon = make(
  <>
    <Circle cx="12" cy="12" r="10" />
    <Polyline points="12 6 12 12 16 14" />
  </>,
);

export const ServerIcon = make(
  <>
    <Rect x="2" y="3" width="20" height="8" rx="2" />
    <Rect x="2" y="13" width="20" height="8" rx="2" />
    <Line x1="6" y1="7" x2="6.01" y2="7" />
    <Line x1="6" y1="17" x2="6.01" y2="17" />
  </>,
);

export const WifiIcon = make(
  <>
    <Path d="M5 12.55a11 11 0 0 1 14 0" />
    <Path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <Path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <Line x1="12" y1="20" x2="12.01" y2="20" />
  </>,
);

export const WifiOffIcon = make(
  <>
    <Line x1="1" y1="1" x2="23" y2="23" />
    <Path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
    <Path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
    <Path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
    <Path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
    <Path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <Line x1="12" y1="20" x2="12.01" y2="20" />
  </>,
);

export const LogOutIcon = make(
  <>
    <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <Polyline points="16 17 21 12 16 7" />
    <Line x1="21" y1="12" x2="9" y2="12" />
  </>,
);

export const EyeIcon = make(
  <>
    <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <Circle cx="12" cy="12" r="3" />
  </>,
);

export const EyeOffIcon = make(
  <>
    <Path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <Path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <Line x1="1" y1="1" x2="23" y2="23" />
  </>,
);

/* ---------- Specialized (agents) ---------- */

export const MonitorIcon = make(
  <>
    <Rect x="2" y="3" width="20" height="14" rx="2" />
    <Line x1="8" y1="21" x2="16" y2="21" />
    <Line x1="12" y1="17" x2="12" y2="21" />
  </>,
);

export const FileTextIcon = make(
  <>
    <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <Polyline points="14 2 14 8 20 8" />
    <Line x1="16" y1="13" x2="8" y2="13" />
    <Line x1="16" y1="17" x2="8" y2="17" />
    <Polyline points="10 9 9 9 8 9" />
  </>,
);

export const ZapIcon = make(<Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);

export const InfoIcon = make(
  <>
    <Circle cx="12" cy="12" r="10" />
    <Line x1="12" y1="16" x2="12" y2="12" />
    <Line x1="12" y1="8" x2="12.01" y2="8" />
  </>,
);

export const PlugIcon = make(
  <>
    <Path d="M12 22v-5" />
    <Path d="M9 7V2" />
    <Path d="M15 7V2" />
    <Path d="M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
  </>,
);

/* ---------- Convenience: an icon with a tinted background circle ---------- */

export const IconBadge: React.FC<{
  Icon: React.FC<IconProps>;
  color: string;
  size?: number;
  badgeSize?: number;
}> = ({Icon, color, size = 22, badgeSize = 44}) => (
  <View
    style={{
      width: badgeSize,
      height: badgeSize,
      borderRadius: badgeSize / 2,
      backgroundColor: color + '22',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
    <Icon size={size} color={color} />
  </View>
);
