import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

// ── Static accent palette (same in light & dark) ──
//
// Two kinds of colour live here and they are NOT interchangeable:
//
//   fills — orange, mint, lavender, gold, blue, star. These paint buttons,
//           tiles and chips. They carry the brand and are chosen to look
//           right, not to be read.
//   ink   — text, muted, and every *Text. These are read, so each one clears
//           WCAG AA (4.5:1) against BOTH the surface it normally sits on and
//           its own soft tint — the tint is the harder case, because it drags
//           the background toward the ink.
//
// A measured sweep (scripts/e2e_contrast.py) found 162 pieces of unreadable
// text across the app, nearly all of it ink drawn in a fill colour: muted at
// 3.2:1, accents on their own tints between 2.8:1 and 3.9:1. Keeping the two
// roles apart is what stops that coming back — which is why orange now has an
// orangeText twin, like every other accent already had.
export const UI = {
  bg: '#FAF6F1',
  card: '#FFFFFF',
  text: '#22201D',
  muted: '#6B635B',
  soft: '#F3ECE3',
  line: '#ECE4DA',
  // ONE orange. This palette carried #F56519 while the theme carried
  // #F26A1B — two brand oranges side by side on the same screens.
  orange: '#F26A1B',
  orangeText: '#B0450B',
  // The brand orange with WHITE on it reads at 3.1:1 — fine as a surface,
  // not fine as a background for a label. This deeper orange is used only
  // where white text or a white glyph sits on the fill (buttons, avatar
  // circles, today's date pill); every other orange surface keeps the vivid
  // brand value above.
  orangeDeep: '#CA470A',
  orangeSoft: '#FDEBDD',
  // The rebrand's tile tints. The keys keep their old names so no screen
  // moves; the hues are the brand's: sage, plum, sand and sky.
  mint: '#E3EFE6',
  mintText: '#2E7852',
  lavender: '#F2E6EF',
  lavenderText: '#843C79',
  gold: '#F5ECDA',
  goldText: '#7C5E16',
  blue: '#E3EBF6',
  blueText: '#2F5A96',
  danger: '#B8322A',
  dangerSoft: 'rgba(184,50,42,0.10)',
  star: '#F59E0B',
  // Checkboxes. An outline is a control boundary, which WCAG holds to 3:1 —
  // the old outline was the card-border grey at 1.3:1, a box a low-vision
  // parent could not find. Done is sage with a white tick, the same on every
  // screen, so "finished" reads as one colour wherever it appears.
  checkLine: '#968B80',
  doneFill: '#2F7D55',
  doneTick: '#FFFFFF',
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
      orangeDeep: UI.orangeDeep,
      // Dark mode moves ink the other way: the brand orange reads at 2.8:1 on
      // its own tint here, so orange TEXT is lightened rather than darkened.
      orangeText: '#FF9B5E',
      orangeSoft: 'rgba(242,106,27,0.15)',
      mint: 'rgba(124,203,156,0.15)',
      mintText: '#7CCB9C',
      lavender: 'rgba(215,155,203,0.15)',
      lavenderText: '#D79BCB',
      gold: 'rgba(225,192,110,0.15)',
      goldText: '#E1C06E',
      blue: 'rgba(143,179,230,0.15)',
      blueText: '#8FB3E6',
      danger: '#F08A80',
      dangerSoft: 'rgba(240,138,128,0.15)',
      checkLine: '#7A6E63',
      doneFill: '#7CCB9C',
      doneTick: '#22201D',
      star: '#F59E0B',
    };
  }, [dark, theme]);
}

export const SERIF = 'PlayfairDisplay_700Bold';

export function ScreenHeader({
  eyebrow,
  title,
  right,
  titleSize = 30,
  showAdd = true,
}: {
  eyebrow: string;
  title: string;
  right?: React.ReactNode;
  titleSize?: number;
  /** Off where "add" has no obvious meaning — Settings, Search, Chat. More is
   *  in the tab bar now, so those headers simply carry nothing on the right. */
  showAdd?: boolean;
}) {
  const ui = useUI();
  const { openQuickAdd, t } = useStore();
  return (
    <View>
      <Text style={[kit.brand, { color: ui.orangeText }]}>Ahenora</Text>
      <View style={kit.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={[kit.eyebrow, { color: ui.muted }]}>{eyebrow}</Text>
          <Text style={[kit.title, { color: ui.text, fontSize: titleSize, lineHeight: titleSize + 6 }]}>{title}</Text>
        </View>
        <View style={kit.headerRight}>
          {right}
          {/* More moved into the tab bar, where it now sits on its own beside
              the four destinations. The corner it freed goes to the thing you
              actually came here to do: add something. Same picker the raised ＋
              used to open, same testID — only the door moved. */}
          {showAdd ? (
            <PressScale
              testID="tab-add"
              onPress={openQuickAdd}
              style={kit.hubBtn}
              accessibilityRole="button"
              accessibilityLabel={t('a11y_add')}
            >
              <Plus color={ui.orangeText} size={19} />
              <Text style={[kit.hubLabel, { color: ui.muted }]}>{t('a11y_add')}</Text>
            </PressScale>
          ) : null}
        </View>
      </View>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hubBtn: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  hubLabel: { fontFamily: 'Figtree_700Bold', fontSize: 9, letterSpacing: 0.2, marginTop: 1 },
  brand: { fontFamily: 'Figtree_800ExtraBold', fontSize: 13, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 8 },
  eyebrow: { fontFamily: 'Figtree_600SemiBold', fontSize: 14, letterSpacing: 0.2, marginBottom: 2 },
  title: { fontFamily: SERIF, letterSpacing: -0.5 },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    // A warm shadow under a warm ground; pure black read as grey dirt.
    shadowColor: '#22201D',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  sectionTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 17, letterSpacing: -0.2 },
  badge: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 10, letterSpacing: 0.4 },
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
  rowTitle: { fontFamily: 'Figtree_700Bold', fontSize: 15 },
  rowSub: { fontFamily: 'Figtree_500Medium', fontSize: 12.5, marginTop: 2 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 8, flex: 1, minWidth: 0 },
  miniAvatar: { width: 38, height: 38, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  miniInitial: { fontFamily: 'Figtree_800ExtraBold', fontSize: 14 },
  miniName: { fontFamily: 'Figtree_700Bold', fontSize: 14 },
  miniSub: { fontFamily: 'Figtree_500Medium', fontSize: 12, marginTop: 1 },
  statBox: { width: '48%', minHeight: 64, borderRadius: 14, borderWidth: 1, padding: 12, justifyContent: 'center' },
  statValue: { fontFamily: 'Figtree_800ExtraBold', fontSize: 16 },
  statLabel: { fontFamily: 'Figtree_500Medium', fontSize: 12, marginTop: 2 },
});
