import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarClock, CalendarX, Clock, X } from 'lucide-react-native';

import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import {
  buildLocalDateTimeIso,
  quickDueDate,
  toLocalDateInput,
  toLocalTimeInput,
} from '../utils/date';

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
  const { theme } = useStore();
  const c = theme.colors;
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('18:00');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const defaultValue = value || quickDueDate('today');
    setDateText(toLocalDateInput(defaultValue));
    setTimeText(toLocalTimeInput(defaultValue));
    setError(null);
  }, [visible, value]);

  const applyQuick = (option: 'today' | 'tomorrow' | 'weekend') => {
    const next = quickDueDate(option);
    setDateText(toLocalDateInput(next));
    setTimeText(toLocalTimeInput(next));
    setError(null);
  };

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
          <Text style={[styles.title, { color: c.text }]}>Schedule card</Text>
        </View>
        <PressScale testID="close-date-picker" onPress={onClose} style={[styles.iconBtn, { borderColor: c.cardBorder }]}>
          <X color={c.text} size={18} />
        </PressScale>
      </View>

      <Text style={[styles.help, { color: c.textMuted }]}>
        Set when this card should appear on the calendar and reminders.
      </Text>

      <View style={styles.quickRow}>
        <PressScale testID="due-today" onPress={() => applyQuick('today')} style={[styles.quickBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
          <Text style={[styles.quickText, { color: c.accent }]}>Today 18:00</Text>
        </PressScale>
        <PressScale testID="due-tomorrow" onPress={() => applyQuick('tomorrow')} style={[styles.quickBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
          <Text style={[styles.quickText, { color: c.accent }]}>Tomorrow 09:00</Text>
        </PressScale>
        <PressScale testID="due-weekend" onPress={() => applyQuick('weekend')} style={[styles.quickBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}>
          <Text style={[styles.quickText, { color: c.accent }]}>Weekend</Text>
        </PressScale>
      </View>

      <Text style={[styles.label, { color: c.textMuted }]}>Date</Text>
      <TextInput
        testID="due-date-input"
        value={dateText}
        onChangeText={setDateText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={c.textSoft}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { backgroundColor: c.bgSoft, borderColor: c.cardBorder, color: c.text }]}
      />

      <Text style={[styles.label, { color: c.textMuted }]}>Time</Text>
      <View style={[styles.timeInputWrap, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
        <Clock color={c.textMuted} size={14} />
        <TextInput
          testID="due-time-input"
          value={timeText}
          onChangeText={setTimeText}
          placeholder="HH:mm"
          placeholderTextColor={c.textSoft}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.timeInput, { color: c.text }]}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <PressScale testID="clear-due-date" onPress={clear} style={[styles.clearBtn, { borderColor: c.cardBorder }]}>
          <CalendarX color={c.textMuted} size={15} />
          <Text style={[styles.clearText, { color: c.textMuted }]}>Clear</Text>
        </PressScale>
        <PressScale testID="save-due-date" onPress={save} style={[styles.saveBtn, { backgroundColor: c.accent }]}>
          <Text style={styles.saveText}>Use date</Text>
        </PressScale>
      </View>
    </KeyboardAwareBottomSheet>
  );
}

const styles = StyleSheet.create({
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
  error: { marginTop: 10, color: '#DC2626', fontFamily: 'Inter_500Medium', fontSize: 12 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 20 },
  clearBtn: {
    flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  clearText: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
