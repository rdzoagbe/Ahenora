import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, CalendarX } from 'lucide-react-native';

import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

type DatePickerSheetProps = {
  visible: boolean;
  /** The currently chosen day, as the display string this sheet emits. */
  value?: string | null;
  title: string;
  onChange: (value: string | null) => void;
  onClose: () => void;
};

/**
 * A day picker with no time in it — three columns, Day · Month · Year.
 *
 * The app's other date field is DateTimePickerSheet, which types a due date
 * AND a clock time as text. A Secret Santa deadline is a day, never a time,
 * and typing "e.g. 24 Dec" into a free-text box is how it used to be set —
 * so the value depended on spelling and could not be relied on for anything.
 *
 * Emits a plain formatted string ("24 Dec 2026", localised) rather than an
 * ISO date, because that is what the field already stores and shows; making
 * the picker structured does not require changing what is saved.
 */
export default function DatePickerSheet({
  visible, value, title, onChange, onClose,
}: DatePickerSheetProps) {
  const ui = useUI();
  const { t, lang } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);

  // A column cell is 9pt padding either side of a ~19pt line, plus 2pt margin
  // top and bottom — measured once here so the open-on-selection scroll below
  // lands on the right row.
  const CELL_H = 41;
  const dayCol = useRef<ScrollView>(null);
  const monthCol = useRef<ScrollView>(null);
  const yearCol = useRef<ScrollView>(null);

  // Plain 'en' formats US-first ("Dec 24, 2026"), which reads wrong in a
  // European product whose own placeholder is "e.g. 24 Dec". en-GB keeps
  // English wording with day-first order; the other languages are day-first
  // already.
  const locale = lang === 'en' ? 'en-GB' : lang;

  const today = useMemo(() => new Date(), []);
  const [day, setDay] = useState(today.getDate());
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());

  // Month names in the reader's own language, short form.
  const months = useMemo(() => Array.from({ length: 12 }, (_, m) =>
    new Date(2000, m, 1).toLocaleDateString(locale, { month: 'short' })), [locale]);

  // This year and the next two — a gift deadline is never further out, and a
  // short list keeps the column tappable rather than an endless scroll.
  const years = useMemo(() => [0, 1, 2].map((n) => today.getFullYear() + n), [today]);

  // Never offer the 31st of a 30-day month, or 30 Feb.
  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  useEffect(() => { if (day > daysInMonth) setDay(daysInMonth); }, [daysInMonth, day]);

  useEffect(() => {
    if (!visible) return;
    // Re-open on the day already chosen where it can be read back, so the
    // picker never silently discards what the organiser set last time.
    const parsed = value ? new Date(value) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      setDay(parsed.getDate());
      setMonth(parsed.getMonth());
      setYear(parsed.getFullYear());
    }
  }, [visible, value]);

  // Open on the day already selected. Without this every column started at
  // its first row, so a date late in the month or year looked unset and the
  // organiser had to scroll to find where they actually were.
  useEffect(() => {
    if (!visible) return;
    const settle = setTimeout(() => {
      const to = (i: number) => ({ y: Math.max(0, (i - 1) * CELL_H), animated: false });
      dayCol.current?.scrollTo(to(day - 1));
      monthCol.current?.scrollTo(to(month));
      yearCol.current?.scrollTo(to(years.indexOf(year)));
    }, 80);
    return () => clearTimeout(settle);
  }, [visible, day, month, year, years]);

  const save = () => {
    const picked = new Date(year, month, day);
    onChange(picked.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }));
    onClose();
  };

  return (
    <KeyboardAwareBottomSheet visible={visible} onClose={onClose} contentStyle={styles.sheet}>
      <View style={styles.header}>
        <CalendarDays color={ui.orangeText} size={18} />
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={styles.cols}>
        <View style={styles.col}>
          <Text style={styles.colLabel}>{t('dp_day')}</Text>
          <ScrollView ref={dayCol} style={styles.colScroll} showsVerticalScrollIndicator={false}>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
              <PressScale key={d} testID={`dp-day-${d}`} onPress={() => setDay(d)}
                style={[styles.cell, d === day && styles.cellOn]}>
                <Text style={[styles.cellText, d === day && styles.cellTextOn]}>{d}</Text>
              </PressScale>
            ))}
          </ScrollView>
        </View>

        <View style={styles.col}>
          <Text style={styles.colLabel}>{t('dp_month')}</Text>
          <ScrollView ref={monthCol} style={styles.colScroll} showsVerticalScrollIndicator={false}>
            {months.map((name, m) => (
              <PressScale key={name} testID={`dp-month-${m}`} onPress={() => setMonth(m)}
                style={[styles.cell, m === month && styles.cellOn]}>
                <Text style={[styles.cellText, m === month && styles.cellTextOn]}>{name}</Text>
              </PressScale>
            ))}
          </ScrollView>
        </View>

        {/* The year, alongside the day and month rather than buried in a
            second step — a draw set in December is usually for the year
            after, so it has to be changeable right here. */}
        <View style={styles.col}>
          <Text style={styles.colLabel}>{t('dp_year')}</Text>
          <ScrollView ref={yearCol} style={styles.colScroll} showsVerticalScrollIndicator={false}>
            {years.map((y) => (
              <PressScale key={y} testID={`dp-year-${y}`} onPress={() => setYear(y)}
                style={[styles.cell, y === year && styles.cellOn]}>
                <Text style={[styles.cellText, y === year && styles.cellTextOn]}>{y}</Text>
              </PressScale>
            ))}
          </ScrollView>
        </View>
      </View>

      <View style={styles.footer}>
        <PressScale testID="dp-clear" onPress={() => { onChange(null); onClose(); }} style={styles.clearBtn}>
          <CalendarX color={ui.muted} size={15} />
          <Text style={styles.clearText}>{t('dt_clear')}</Text>
        </PressScale>
        <PressScale testID="dp-save" onPress={save} style={styles.saveBtn}>
          <Text style={styles.saveText}>{t('dt_use')}</Text>
        </PressScale>
      </View>
    </KeyboardAwareBottomSheet>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  // The sheet reserves 120pt for a pinned footer; this one has no pinned
  // footer, so that reservation would just read as dead space under the buttons.
  sheet: { backgroundColor: ui.card, borderColor: ui.line, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },

  cols: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  colLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12, marginBottom: 7, textAlign: 'center' },
  colScroll: { height: 188, backgroundColor: ui.bg, borderRadius: 12, borderWidth: 1, borderColor: ui.line },
  cell: { paddingVertical: 9, alignItems: 'center', borderRadius: 9, marginHorizontal: 4, marginVertical: 2 },
  cellOn: { backgroundColor: ui.orange },
  cellText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  cellTextOn: { color: '#fff', fontFamily: 'Inter_800ExtraBold' },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: ui.line },
  clearText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13.5 },
  saveBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: ui.orange },
  saveText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 14.5 },
});
