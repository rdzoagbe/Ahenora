import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { PressScale } from './PressScale';

// ── Shared "minimal monochrome + accent" palette (matches the redesigned Feed) ──
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

export const SERIF = 'PlayfairDisplay_700Bold';

// ── Page header: small grey eyebrow + big serif title, with optional right slot ──
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
  return (
    <View style={kit.headerRow}>
      <View style={{ flex: 1 }}>
        <Text style={kit.eyebrow}>{eyebrow}</Text>
        <Text style={[kit.title, { fontSize: titleSize, lineHeight: titleSize + 6 }]}>{title}</Text>
      </View>
      {right ? <View style={kit.headerRight}>{right}</View> : null}
    </View>
  );
}

// ── White rounded card with subtle border + shadow ──
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[kit.card, style]}>{children}</View>;
}

// ── Bold section header above a card ──
export function SectionTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[kit.sectionTitle, style]}>{children}</Text>;
}

// ── Tinted rounded-square icon tile ──
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

// ── Small uppercase status pill ──
export function Badge({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <View style={[kit.badge, { backgroundColor: bg }]}>
      <Text style={[kit.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ── iOS-style toggle (visual only; wrap with a pressable for behaviour) ──
export function Toggle({ on }: { on: boolean }) {
  return (
    <View style={[kit.toggle, { backgroundColor: on ? UI.orange : UI.line }]}>
      <View style={[kit.toggleKnob, on ? { right: 3 } : { left: 3 }]} />
    </View>
  );
}

// ── Thin progress track + fill ──
export function ProgressBar({ pct, color = UI.orange, track = UI.soft }: { pct: number; color?: string; track?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={[kit.progressTrack, { backgroundColor: track }]}>
      <View style={[kit.progressFill, { width: `${clamped}%`, backgroundColor: color }]} />
    </View>
  );
}

// ── Chevron indicator that rotates between right / down ──
export function Chevron({ open }: { open: boolean }) {
  return open ? <ChevronDown color={UI.muted} size={18} /> : <ChevronRight color={UI.muted} size={18} />;
}

// ── Thin horizontal rule ──
export function Divider() {
  return <View style={kit.divider} />;
}

// ── Tappable row with icon tile + label + optional right slot ──
export function NavRow({ tile, title, subtitle, right, onPress, testID, divider = true }: { tile: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; testID?: string; divider?: boolean }) {
  return (
    <PressScale testID={testID} onPress={onPress} style={[kit.row, divider && kit.rowBorder]}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={kit.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={kit.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : <ChevronRight color={UI.muted} size={18} />}
    </PressScale>
  );
}

// ── Row with toggle on the trailing edge ──
export function ToggleRow({ tile, title, subtitle, on, onPress, testID, disabled, divider = true }: { tile: React.ReactNode; title: string; subtitle?: string; on: boolean; onPress: () => void; testID?: string; disabled?: boolean; divider?: boolean }) {
  return (
    <PressScale testID={testID} onPress={onPress} disabled={disabled} style={[kit.row, divider && kit.rowBorder]}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={kit.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={kit.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <Toggle on={on} />
    </PressScale>
  );
}

// ── Compact avatar + name row ──
export function MiniRow({ initial, name, sub }: { initial?: string; name: string; sub?: string }) {
  return (
    <View style={kit.miniRow}>
      <View style={kit.miniAvatar}><Text style={kit.miniInitial}>{initial || '?'}</Text></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={kit.miniName} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={kit.miniSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// ── Bordered stat tile (label + value) ──
export function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={kit.statBox}>
      <Text style={kit.statValue}>{value}</Text>
      <Text style={kit.statLabel}>{label}</Text>
    </View>
  );
}

const kit = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerRight: { alignItems: 'flex-end', justifyContent: 'center' },
  eyebrow: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14, letterSpacing: 0.2, marginBottom: 2 },
  title: { color: UI.text, fontFamily: SERIF, letterSpacing: -0.5 },
  card: {
    borderRadius: 22,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.line,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.2 },
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
  divider: { height: 1, backgroundColor: UI.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: UI.line },
  rowTitle: { color: UI.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  rowSub: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, flex: 1, minWidth: 0 },
  miniAvatar: { width: 38, height: 38, borderRadius: 99, backgroundColor: UI.soft, alignItems: 'center', justifyContent: 'center' },
  miniInitial: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  miniName: { color: UI.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  miniSub: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 1 },
  statBox: { width: '48%', minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.soft, padding: 12, justifyContent: 'center' },
  statValue: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  statLabel: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
});
