import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CalendarPlus, ListChecks, ScanLine, UtensilsCrossed } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { QUICK_TILE } from '../homeTiles';

/**
 * The row of four under the day on Home, as in the reference Roland chose on
 * 2026-10-31: add an event, add a chore, plan a meal, scan a document. Each is
 * something that already exists one or two screens away; this puts it under a
 * thumb on the first screen.
 *
 * "Add chore" is for a household with children whose side of the app is on.
 * Without children it becomes "Add task", which goes to the same composer as
 * everything else, so the row never offers a door to a page that is put away.
 */
export function HomeQuickActions({
  kidsShown,
  onEvent,
  onChore,
  onMeal,
  onScan,
}: {
  kidsShown: boolean;
  onEvent: () => void;
  onChore: () => void;
  onMeal: () => void;
  onScan: () => void;
}) {
  const ui = useUI();
  const { t, theme } = useStore();
  const dark = theme.mode === 'dark';
  const styles = useMemo(() => createStyles(ui), [ui]);

  const tiles = [
    { key: 'event', label: t('home_qa_event'), Icon: CalendarPlus, tone: QUICK_TILE.event, onPress: onEvent },
    {
      key: 'chore',
      label: kidsShown ? t('home_qa_chore') : t('home_qa_task'),
      Icon: ListChecks,
      tone: QUICK_TILE.chore,
      onPress: onChore,
    },
    { key: 'meal', label: t('home_qa_meal'), Icon: UtensilsCrossed, tone: QUICK_TILE.meal, onPress: onMeal },
    { key: 'scan', label: t('home_qa_scan'), Icon: ScanLine, tone: QUICK_TILE.scan, onPress: onScan },
  ];

  return (
    <View style={styles.wrap} testID="home-quick-actions">
      <Text style={styles.title} accessibilityRole="header">{t('home_quick_actions')}</Text>
      <View style={styles.row}>
        {tiles.map(({ key, label, Icon, tone, onPress }) => (
          <PressScale
            key={key}
            testID={`home-qa-${key}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            style={styles.tile}
          >
            {/* Light: the colour as a soft tile with its ink. Dark: the solid
                colour with a white glyph, which is what reads on a dark page. */}
            <View style={[styles.icon, { backgroundColor: dark ? tone.solid : tone.soft }]}>
              <Icon color={dark ? '#FFFFFF' : tone.solid} size={24} strokeWidth={2.2} />
            </View>
            <Text style={styles.label} numberOfLines={2}>{label}</Text>
          </PressScale>
        ))}
      </View>
    </View>
  );
}

function createStyles(ui: UIColors) {
  return StyleSheet.create({
    wrap: { marginTop: 22, marginBottom: 18 },
    title: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 17, marginBottom: 12, paddingHorizontal: 2 },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    tile: { flex: 1, alignItems: 'center', gap: 8 },
    icon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    label: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 13, lineHeight: 17, textAlign: 'center' },
  });
}
