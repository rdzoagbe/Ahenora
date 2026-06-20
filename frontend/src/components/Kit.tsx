import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

// ── Static accent palette (same in light & dark) ──
export const UI = {
  bg: '#F6F3EE',
  card: '#FFFFFF',
  text: '#101318',
  muted: '#8A909A',
  soft: '#F1EFEA',
  line: '#E6E1DA',
  orange: '#F56519',
  orangeSoft: '#FFF0E7',
  mint: '#DFF7EC',
  mintText: '#0FA36B',
  lavender: '#EDEBFF',
  lavenderText: '#6B5CFF',
  gold: '#FBEFD6',
  goldText: '#B7791F',
  blue: '#E8F0FE',
  blueText: '#1A73E8',
  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.10)',
  star: '#F59E0B',
};

export type UIColors = typeof UI;

export function useUI(): UIColors {
  const { theme } = useStore();
  const dark = theme.mode === 'dark';
  return useMemo(() => {
    if (!dark) return { ...UI };
    return {
      bg: theme.colors.bg,
      card: theme.colors.card,
      text: theme.colors.text,
      muted: theme.colors.textMuted,
      soft: theme.colors.bgSoft,
      line: theme.colors.cardBorder,
      orange: UI.orange,
      orangeSoft: 'rgba(245,101,25,0.15)',
      mint: 'rgba(15,163,107,0.15)',
      mintText: '#34D399',
      lavender: 'rgba(107,92,255,0.15)',
      lavenderText: '#A78BFA',
      gold: 'rgba(245,158,11,0.15)',
      goldText: '#FBBF24',
      blue: 'rgba(26,115,232,0.15)',
      blueText: '#60A5FA',
      danger: '#EF4444',
      dangerSoft: 'rgba(239,68,68,0.15)',
      star: '#F59E0B',
    };
  }, [dark, theme]);
}

export const SERIF = 'PlayfairDisplay_700Bold';

export function ScreenHeader({
  eyebrow,
  title,
  right,
  titleSize = 38,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
  titleSize?: number;
}) {
  const ui = useUI();
  return (
    <View style={kit.headerRow}>
      <View style={{ flex: 1 }}>
        <Text style={[kit.eyebrow, { color: ui.muted }]}>{eyebrow}</Text>
        <Text style={[kit.title, { color: ui.text, fontSize: titleSize, lineHeight: titleSize + 6 }]}>{title}</Text>
      </View>
      {right ? <View style={kit.headerRight}>{right}</View> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const ui = useUI();
  return <View style={[kit.card, { backgroundColor: ui.card, borderColor: ui.line }, style]}>{children}</View>;
}

export function SectionTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const ui = useUI();
  return <Text style={[kit.sectionTitle, { color: ui.text }, style]}>{children}</Text>;
}

export function IconTile({
  bg,
  size = 40,
  radius = 13,
  children,
  style,
}: {
  bg: string;
  size?: number;
  radius?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }, style]}>
      {children}
    </View>
  );
}

export function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <View style={[kit.badge, { backgroundColor: bg }]}>
      <Text style={[kit.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Toggle({ on }: { on: boolean }) {
  const ui = useUI();
  return (
    <View style={[kit.toggle, { backgroundColor: on ? ui.orange : ui.line }]}>
      <View style={[kit.toggleKnob, on ? { right: 3 } : { left: 3 }]} />
    </View>
  );
}

export function ProgressBar({ pct, color = UI.orange, track }: { pct: number; color?: string; track?: string }) {
  const ui = useUI();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={[kit.progressTrack, { backgroundColor: track || ui.soft }]}>
      <View style={[kit.progressFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

export function Chevron({ open }: { open: boolean }) {
  const ui = useUI();
  return open ? <ChevronDown color={ui.muted} size={18} /> : <ChevronRight color={ui.muted} size={18} />;
}

export function Divider() {
  const ui = useUI();
  return <View style={[kit.divider, { backgroundColor: ui.line }]} />;
}

export function NavRow({ tile, title, subtitle, right, onPress, testID, divider = true }: { tile: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; testID?: string; divider?: boolean }) {
  const ui = useUI();
  return (
    <PressScale testID={testID} onPress={onPress} style={[kit.row, divider && kit.rowBorder, divider && { borderBottomColor: ui.line }]}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[kit.rowTitle, { color: ui.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[kit.rowSub, { color: ui.muted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : <ChevronRight color={ui.muted} size={18} />}
    </PressScale>
  );
}

export function ToggleRow({ tile, title, subtitle, on, onPress, testID, disabled, divider = true }: { tile: React.ReactNode; title: string; subtitle?: string; on: boolean; onPress: () => void; testID?: string; disabled?: boolean; divider?: boolean }) {
  const ui = useUI();
  return (
    <PressScale testID={testID} onPress={onPress} disabled={disabled} style={[kit.row, divider && kit.rowBorder, divider && { borderBottomColor: ui.line }]}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[kit.rowTitle, { color: ui.text }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[kit.rowSub, { color: ui.muted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <Toggle on={on} />
    </PressScale>
  );
}

export function MiniRow({ initial, name, sub }: { initial?: string; name: string; sub?: string }) {
  const ui = useUI();
  return (
    <View style={kit.miniRow}>
      <View style={[kit.miniAvatar, { backgroundColor: ui.soft }]}><Text style={[kit.miniInitial, { color: ui.text }]}>{initial || '?'}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[kit.miniName, { color: ui.text }]} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={[kit.miniSub, { color: ui.muted }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export function StatBox({ label, value }: { label: string; value: string }) {
  const ui = useUI();
  return (
    <View style={[kit.statBox, { borderColor: ui.line, backgroundColor: ui.soft }]}>
      <Text style={[kit.statValue, { color: ui.text }]}>{value}</Text>
      <Text style={[kit.statLabel, { color: ui.muted }]}>{label}</Text>
    </View>
  );
}

const kit = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerRight: { alignItems: 'flex-end', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 14, letterSpacing: 0.2, marginBottom: 2 },
  title: { fontFamily: SERIF, letterSpacing: -0.5 },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.2 },
  badge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, letterSpacing: 0.4 },
  toggle: { width: 46, height: 28, borderRadius: 99, justifyContent: 'center' },
  toggleKnob: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 99,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  progressTrack: { height: 7, borderRadius: 99, overflow: 'hidden', width: '100%' },
  progressFill: { height: '100%', borderRadius: 99 },
  divider: { height: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1 },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  rowSub: { fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, flex: 1, minWidth: 0 },
  miniAvatar: { width: 38, height: 38, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  miniInitial: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  miniName: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  miniSub: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 1 },
  statBox: { width: '48%', minHeight: 64, borderRadius: 14, borderWidth: 1, padding: 12, justifyContent: 'center' },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
});
