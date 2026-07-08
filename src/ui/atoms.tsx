/**
 * Small reusable UI atoms. Keep this file tight — primitives only.
 */
import React from 'react';
import {View, Text, TextInput, TouchableOpacity, ViewStyle, TextStyle, TextInputProps} from 'react-native';
import {palette, radii, spacing, type} from './theme';

export const Screen: React.FC<{children: React.ReactNode; style?: ViewStyle}> = ({children, style}) => (
  <View style={[{flex: 1, backgroundColor: palette.bg}, style]}>{children}</View>
);

export const Card: React.FC<{children: React.ReactNode; style?: ViewStyle; onPress?: () => void}> = ({
  children, style, onPress,
}) => {
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

export const Text2: React.FC<{children: React.ReactNode; style?: TextStyle; numberOfLines?: number}> = ({
  children, style, numberOfLines,
}) => (
  <Text style={style} numberOfLines={numberOfLines}>{children}</Text>
);

export const H1: React.FC<{children: React.ReactNode; style?: TextStyle}> = ({children, style}) => (
  <Text style={[type.h1, style]}>{children}</Text>
);

export const H2: React.FC<{children: React.ReactNode; style?: TextStyle}> = ({children, style}) => (
  <Text style={[type.h2, style]}>{children}</Text>
);

export const Body: React.FC<{children: React.ReactNode; style?: TextStyle; muted?: boolean}> = ({
  children, style, muted,
}) => (
  <Text style={[muted ? type.bodyMuted : type.body, style]}>{children}</Text>
);

export const Caption: React.FC<{children: React.ReactNode}> = ({children}) => (
  <Text style={type.caption}>{children}</Text>
);

export const Divider: React.FC = () => (
  <View style={{height: 1, backgroundColor: palette.border, marginVertical: spacing.md}} />
);

interface FieldProps extends TextInputProps {
  label: string;
}
export const Field: React.FC<FieldProps> = ({label, style, ...rest}) => (
  <View style={{marginVertical: spacing.sm}}>
    <Text style={[type.caption, {marginBottom: 4}]}>{label.toUpperCase()}</Text>
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
  const stylesByVariant: Record<string, ViewStyle> = {
    primary: {backgroundColor: palette.accent},
    secondary: {backgroundColor: palette.surfaceAlt, borderWidth: 1, borderColor: palette.border},
    ghost: {backgroundColor: 'transparent'},
    danger: {backgroundColor: palette.danger},
  };
  const textByVariant: Record<string, string> = {
    primary: '#0b0d10',
    secondary: palette.text,
    ghost: palette.accent,
    danger: '#0b0d10',
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

export const StatusDot: React.FC<{online: boolean}> = ({online}) => (
  <View
    style={{
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: online ? palette.success : palette.danger,
      marginRight: 6,
    }}
  />
);
