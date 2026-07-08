/**
 * Small reusable UI atoms. Theme-aware via useTheme().
 */
import React from 'react';
import {View, Text, TextInput, TouchableOpacity, ViewStyle, TextStyle, TextInputProps} from 'react-native';
import {useTheme} from './theme.tsx';

export const Screen: React.FC<{children: React.ReactNode; style?: ViewStyle}> = ({children, style}) => {
  const {palette} = useTheme();
  return <View style={[{flex: 1, backgroundColor: palette.bg}, style]}>{children}</View>;
};

export const Card: React.FC<{children: React.ReactNode; style?: ViewStyle; onPress?: () => void}> = ({
  children, style, onPress,
}) => {
  const {palette, radii, spacing} = useTheme();
  const inner = (
    <View
      style={[
        {
          backgroundColor: palette.surface,
          borderRadius: radii.lg,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: palette.border,
        },
        style,
      ]}>
      {children}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
};

export const H1: React.FC<{children: React.ReactNode; style?: TextStyle}> = ({children, style}) => {
  const {type} = useTheme();
  return <Text style={[type.h1, style]}>{children}</Text>;
};

export const H2: React.FC<{children: React.ReactNode; style?: TextStyle}> = ({children, style}) => {
  const {type} = useTheme();
  return <Text style={[type.h2, style]}>{children}</Text>;
};

export const Body: React.FC<{children: React.ReactNode; style?: TextStyle; muted?: boolean}> = ({
  children, style, muted,
}) => {
  const {type, palette} = useTheme();
  return <Text style={[muted ? {...type.bodyMuted, color: palette.textMuted} : type.body, style]}>{children}</Text>;
};

export const Caption: React.FC<{children: React.ReactNode; style?: TextStyle}> = ({children, style}) => {
  const {type, palette} = useTheme();
  return <Text style={[type.monoMuted, {color: palette.textMuted}, style]}>{children}</Text>;
};

export const Divider: React.FC = () => {
  const {palette, spacing} = useTheme();
  return <View style={{height: 1, backgroundColor: palette.border, marginVertical: spacing.md}} />;
};

interface FieldProps extends TextInputProps {
  label: string;
}
export const Field: React.FC<FieldProps> = ({label, style, ...rest}) => {
  const {type, palette, radii, spacing} = useTheme();
  return (
    <View style={{marginVertical: spacing.sm}}>
      <Text style={[type.label, {color: palette.textMuted, marginBottom: 4}]}>{label.toUpperCase()}</Text>
      <TextInput
        placeholderTextColor={palette.textDim}
        {...rest}
        style={[
          {
            backgroundColor: palette.surfaceAlt,
            color: palette.text,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            fontSize: 15,
            borderWidth: 1,
            borderColor: palette.border,
          },
          style,
        ]}
      />
    </View>
  );
};

interface BtnProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  icon?: string;
}
export const Button: React.FC<BtnProps> = ({title, onPress, variant = 'primary', disabled, loading, style, icon}) => {
  const {palette, radii, spacing, type} = useTheme();
  const stylesByVariant: Record<string, ViewStyle> = {
    primary: {backgroundColor: palette.accent},
    secondary: {backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: palette.border},
    ghost: {backgroundColor: 'transparent'},
    danger: {backgroundColor: palette.error},
  };
  const textByVariant: Record<string, string> = {
    primary: palette.bg,
    secondary: palette.text,
    ghost: palette.accent,
    danger: palette.bg,
  };
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        {
          borderRadius: radii.md,
          paddingVertical: 12,
          paddingHorizontal: spacing.lg,
          alignItems: 'center',
          opacity: disabled ? 0.5 : 1,
        },
        stylesByVariant[variant],
        style,
      ]}>
      <Text style={{color: textByVariant[variant], fontSize: 15, fontWeight: '600'}}>
        {loading ? '…' : `${icon ? icon + '  ' : ''}${title}`}
      </Text>
    </TouchableOpacity>
  );
};

export const StatusDot: React.FC<{online: boolean}> = ({online}) => {
  const {palette} = useTheme();
  return (
    <View
      style={{
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: online ? palette.success : palette.error,
        marginRight: 6,
      }}
    />
  );
};
