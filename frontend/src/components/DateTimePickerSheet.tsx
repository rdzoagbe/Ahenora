import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarClock, CalendarX, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react-native';

import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import {
  buildLocalDateTimeIso,
  buildMonthDays,
  localeFor,
  pad2,
  quickDueDate,
  toLocalDateInput,
  toLocalTimeInput,
} from '../utils/date';

/** The date half of an ISO-ish "YYYY-MM-DD", as a real Date at local noon.
 *  Noon, not midnight: a DST jump at 00:00 in some zones lands the date on the
 *  day before, which is a bug you only see twice a year and in one hemisphere. */
function dayFromText(text: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text || '')) return null;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function textFromDay(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** The times a family task actually lands on.
 *
 *  A wheel of 1,440 minutes is precision nobody asked for: school runs, meals,
 *  bedtime and appointments are on the hour and the half hour. These are one
 *  tap; anything else is still typeable below. */
const TIME_SLOTS = [
  '07:00', '07:30', '08:00', '08:30', '09:00', '12:00', '12:30',
  '15:00', '15:30', '16:00', '17:00', '17:30', '18:00', '18:30',
  '19:00', '19:30', '20:00', '21:00',
];

type DateTimePickerSheetProps = {
  visible: boolean;
  value?: string | null;
  onChange: (value: string | null) => void;
  onClose: () => void;
};

export default function DateTimePickerSheet({
  visible,
  value,
  onChange,
  onClose,
}: DateTimePickerSheetProps) {
  const { theme, t, lang } = useStore();
  const c = theme.colors;
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('18:00');
  const [error, setError] = useState<string | null>(null);
  // Which month the grid shows. Follows the selection when the sheet opens,
  // then moves independently as the arrows are used.
  const [month, setMonth] = useState<Date>(() => new Date());
  // The typed fields are still here — a screen reader, a keyboard, and anyone
  // who already knows the date are all faster with a field than a grid — but
  // they are no longer the only way in. Folded away so the grid is what a
  // parent meets first.
  const [typing, setTyping] = useState(false);
  const slotScroll = useRef<ScrollView | null>(null);

  useEffect(() => {
    if (!visible) return;
    const defaultValue = value || quickDueDate('today');
    const text = toLocalDateInput(defaultValue);
    setDateText(text);
    setTimeText(toLocalTimeInput(defaultValue));
    setMonth(dayFromText(text) || new Date());
    setTyping(false);
    setError(null);
  }, [visible, value]);

  const applyQuick = (option: 'today' | 'tomorrow' | 'weekend') => {
    const next = quickDueDate(option);
    const text = toLocalDateInput(next);
    setDateText(text);
    setTimeText(toLocalTimeInput(next));
    // Move the grid to match. Leaving it behind would show September while the
    // sheet claimed the weekend was picked, which is how somebody saves the
    // wrong date and blames themselves.
    setMonth(dayFromText(text) || new Date());
    setError(null);
  };

  const pickDay = (date: Date) => {
    setDateText(textFromDay(date));
    setError(null);
  };

  const shiftMonth = (by: number) => {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  };

  // Bring the chosen time into view. The default is 18:00, which sits two
  // thirds along the row — so without this the row opens on 07:00 and the sheet
  // silently shows a time that is not the one it will save.
  useEffect(() => {
    if (!visible) return;
    const index = TIME_SLOTS.indexOf(timeText);
    if (index < 0) return;
    const id = setTimeout(() => {
      slotScroll.current?.scrollTo({ x: Math.max(0, index * 72 - 80), animated: false });
    }, 60);
    return () => clearTimeout(id);
  }, [visible, timeText]);

  const today = useMemo(() => new Date(), [visible]);
  const selectedDay = useMemo(() => dayFromText(dateText), [dateText]);
  const monthDays = useMemo(() => buildMonthDays(month), [month]);
  // Read off a known Monday rather than hard-coded letters, so a French or
  // German household gets L M M J V S D and M D M D F S S without a table.
  const weekdayInitials = useMemo(() => {
    const monday = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      return d.toLocaleDateString(localeFor(lang), { weekday: 'narrow' });
    });
  }, [lang]);

  const save = () => {
    try {
      const iso = buildLocalDateTimeIso(dateText, timeText);
      onChange(iso);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Invalid date/time');
    }
  };

  const clear = () => {
    onChange(null);
    onClose();
  };

  return (
    <KeyboardAwareBottomSheet
      visible={visible}
      onClose={onClose}
      contentStyle={[styles.sheet, { backgroundColor: c.card, borderColor: c.cardBorder }]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <CalendarClock color={c.accent} size={18} />
          <Text style={[styles.title, { color: c.text }]}>{t('dt_title')}</Text>
        </View>
        <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-date-picker" onPress={onClose} style={[styles.iconBtn, { borderColor: c.cardBorder }]}>
          <X color={c.text} size={18} />
        </PressScale>
      </View>

      <Text style={[styles.help, { color: c.textMuted }]}>
        {t('dt_help')}
      </Text>

      <View style={styles.quickRow}>
        <PressScale testID="due-today" onPress={() => applyQuick('today')} style={[styles.quickBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
          <Text style={[styles.quickText, { color: c.accent }]}>{t('dt_today')}</Text>
        </PressScale>
        <PressScale testID="due-tomorrow" onPress={() => applyQuick('tomorrow')} style={[styles.quickBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
          <Text style={[styles.quickText, { color: c.accent }]}>{t('dt_tomorrow')}</Text>
        </PressScale>
        <PressScale testID="due-weekend" onPress={() => applyQuick('weekend')} style={[styles.quickBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
          <Text style={[styles.quickText, { color: c.accent }]}>{t('dt_weekend')}</Text>
        </PressScale>
      </View>

      {/* The month, and a way through it. */}
      <View style={styles.monthRow}>
        <PressScale
          testID="due-month-prev"
          accessibilityRole="button"
          accessibilityLabel={t('dt_prev_month')}
          onPress={() => shiftMonth(-1)}
          style={[styles.monthBtn, { borderColor: c.cardBorder }]}
        >
          <ChevronLeft color={c.text} size={18} />
        </PressScale>
        <Text testID="due-month-label" style={[styles.monthLabel, { color: c.text }]}>
          {month.toLocaleDateString(localeFor(lang), { month: 'long', year: 'numeric' })}
        </Text>
        <PressScale
          testID="due-month-next"
          accessibilityRole="button"
          accessibilityLabel={t('dt_next_month')}
          onPress={() => shiftMonth(1)}
          style={[styles.monthBtn, { borderColor: c.cardBorder }]}
        >
          <ChevronRight color={c.text} size={18} />
        </PressScale>
      </View>

      {/* Weekday initials, Monday first — buildMonthDays lays the grid out that
          way and the two must agree, or every date is off by a column. */}
      <View style={styles.weekRow}>
        {weekdayInitials.map((d, i) => (
          <Text key={`${d}-${i}`} style={[styles.weekday, { color: c.textSoft }]}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {monthDays.map(({ date, inMonth }) => {
          const selected = selectedDay ? sameDay(date, selectedDay) : false;
          const isToday = sameDay(date, today);
          return (
            // The 1/7 width lives on a plain wrapper, never on the PressScale.
            // splitStyles copies layout keys onto the inner animated view as
            // well as the Pressable, so a percentage width is applied twice —
            // 14.28% of 14.28% — and the cell collapses to a 2%-wide sliver.
            // Invisible until something paints a background on it, which is
            // exactly how this shipped as a thin orange bar where the selected
            // day should have been. Same trap the composer footer documents.
            <View key={date.toISOString()} style={styles.dayCell}>
              <PressScale
                testID={`due-day-${textFromDay(date)}`}
                accessibilityRole="button"
                accessibilityLabel={date.toLocaleDateString(localeFor(lang), {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
                accessibilityState={{ selected }}
                onPress={() => pickDay(date)}
                style={[
                  styles.day,
                  selected && { backgroundColor: c.accent },
                  !selected && isToday && { borderColor: c.accent, borderWidth: 1.5 },
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    { color: selected ? '#FFFFFF' : inMonth ? c.text : c.textSoft },
                    isToday && !selected && { color: c.accent },
                  ]}
                >
                  {date.getDate()}
                </Text>
              </PressScale>
            </View>
          );
        })}
      </View>

      <Text style={[styles.label, { color: c.textMuted }]}>{t('dt_time')}</Text>
      <ScrollView
        ref={slotScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.slotRow}
      >
        {TIME_SLOTS.map((slot) => {
          const on = slot === timeText;
          return (
            <PressScale
              key={slot}
              testID={`due-time-${slot}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => { setTimeText(slot); setError(null); }}
              style={[
                styles.slot,
                { borderColor: c.cardBorder, backgroundColor: c.bgSoft },
                on && { backgroundColor: c.accent, borderColor: c.accent },
              ]}
            >
              <Text style={[styles.slotText, { color: on ? '#FFFFFF' : c.text }]}>{slot}</Text>
            </PressScale>
          );
        })}
      </ScrollView>

      {/* Typing stays reachable. A grid is faster for "some Tuesday" and slower
          for "the 3rd", and it is not what a screen reader wants at all. */}
      <PressScale
        testID="due-toggle-typing"
        accessibilityRole="button"
        onPress={() => setTyping((v) => !v)}
        style={styles.typeToggle}
      >
        <Text style={[styles.typeToggleText, { color: c.accent }]}>
          {typing ? t('dt_hide_typing') : t('dt_show_typing')}
        </Text>
      </PressScale>

      {typing ? (
        <>
          <Text style={[styles.label, { color: c.textMuted }]}>{t('dt_date')}</Text>
          <TextInput
            testID="due-date-input"
            value={dateText}
            onChangeText={(next) => {
              setDateText(next);
              const parsed = dayFromText(next);
              if (parsed) setMonth(parsed);
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={c.textSoft}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { backgroundColor: c.bgSoft, borderColor: c.cardBorder, color: c.text }]}
          />

          <View style={[styles.timeInputWrap, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
            <Clock color={c.textMuted} size={14} />
            <TextInput
              testID="due-time-input" returnKeyType="done" onSubmitEditing={() => save()}
              value={timeText}
              onChangeText={setTimeText}
              placeholder="HH:mm"
              placeholderTextColor={c.textSoft}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.timeInput, { color: c.text }]}
            />
          </View>
        </>
      ) : null}

      {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}

      <View style={styles.footer}>
        <PressScale testID="clear-due-date" onPress={clear} style={[styles.clearBtn, { borderColor: c.cardBorder }]}>
          <CalendarX color={c.textMuted} size={15} />
          <Text style={[styles.clearText, { color: c.textMuted }]}>{t('dt_clear')}</Text>
        </PressScale>
        <PressScale testID="save-due-date" onPress={save} style={[styles.saveBtn, { backgroundColor: c.accent }]}>
          <Text style={styles.saveText}>{t('dt_use')}</Text>
        </PressScale>
      </View>
    </KeyboardAwareBottomSheet>
  );
}

const DAY = 40;

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 4, marginBottom: 8,
  },
  monthBtn: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  monthLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, textTransform: 'capitalize' },
  weekRow: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: {
    width: `${100 / 7}%`, textAlign: 'center', fontFamily: 'Inter_600SemiBold',
    fontSize: 11, marginBottom: 2, textTransform: 'uppercase',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  // 44pt is the tap target the targets harness holds every control to; the
  // circle inside it is smaller so a month does not become a wall of discs.
  dayCell: { width: `${100 / 7}%`, alignItems: 'center' },
  day: {
    width: DAY, height: DAY, alignItems: 'center', justifyContent: 'center',
    borderRadius: DAY / 2,
  },
  dayText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  slotRow: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  slot: {
    minHeight: 44, minWidth: 64, paddingHorizontal: 12, borderRadius: 999,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  slotText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  typeToggle: { minHeight: 44, justifyContent: 'center', marginTop: 4 },
  typeToggleText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 130,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 26 },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1 },
  help: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 14 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  quickBtn: { borderRadius: 9999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  quickText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  label: {
    fontFamily: 'Inter_500Medium', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8,
  },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  timeInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14 },
  timeInput: { flex: 1, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  error: { marginTop: 10, fontFamily: 'Inter_500Medium', fontSize: 12 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 20 },
  clearBtn: {
    flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  clearText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
