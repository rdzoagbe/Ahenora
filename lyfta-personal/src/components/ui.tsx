import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
} from 'react-native';
import { useStore } from '../store';

// ─── Shared visual primitives ────────────────────────────────────────────────
// Thin, theme-aware building blocks so every screen looks like one app without
// each one re-deriving colors.

export function Card({ style, ...rest }: ViewProps) {
  const { theme } = useStore();
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.cardBorder,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 18,
          padding: 16,
        },
        style,
      ]}
      {...rest}
    />
  );
}

type TextVariant = 'title' | 'heading' | 'body' | 'muted' | 'soft' | 'label';

export function AppText({
  variant = 'body',
  style,
  ...rest
}: TextProps & { variant?: TextVariant }) {
  const { theme } = useStore();
  const map: Record<TextVariant, object> = {
    title: { color: theme.colors.text, fontSize: 28, fontWeight: '800' },
    heading: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
    body: { color: theme.colors.text, fontSize: 15, fontWeight: '500' },
    muted: { color: theme.colors.textMuted, fontSize: 14, fontWeight: '500' },
    soft: { color: theme.colors.textSoft, fontSize: 13, fontWeight: '500' },
    label: {
      color: theme.colors.textSoft,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase' as const,
    },
  };
  return <Text style={[map[variant], style]} {...rest} />;
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: PressableProps['style'];
}) {
  const { theme } = useStore();
  const c = theme.colors;
  const palette: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.bgSoft, fg: c.text, border: c.cardBorder },
    ghost: { bg: 'transparent', fg: c.textMuted, border: 'transparent' },
    danger: { bg: 'transparent', fg: c.danger, border: c.danger },
  };
  const p = palette[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={(state) => [
        {
          backgroundColor: p.bg,
          borderColor: p.border,
          borderWidth: kind === 'secondary' || kind === 'danger' ? StyleSheet.hairlineWidth : 0,
          borderRadius: 14,
          paddingVertical: 14,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.45 : state.pressed ? 0.85 : 1,
        },
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <>
          {icon}
          <Text style={{ color: p.fg, fontSize: 15, fontWeight: '700' }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Divider() {
  const { theme } = useStore();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.cardBorder,
        marginVertical: 4,
      }}
    />
  );
}

export function Badge({ text, color }: { text: string; color?: string }) {
  const { theme } = useStore();
  const c = color ?? theme.colors.textSoft;
  return (
    <View
      style={{
        backgroundColor: theme.colors.bgSoft,
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: c, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 10 }}>
      {icon}
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="soft" style={{ textAlign: 'center', lineHeight: 20 }}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}
