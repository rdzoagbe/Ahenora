import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { CalendarClock, CalendarX, Clock, X } from 'lucide-react-native';

import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { PressScale } from './PressScale';
import { UI } from './Kit';
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
      contentStyle={styles.sheet}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <CalendarClock color={UI.orange} size={18} />
          <Text style={styles.title}>Schedule card</Text>
        </View>

        <PressScale testID="close-date-picker" onPress={onClose} style={styles.iconBtn}>
          <X color={UI.text} size={18} />
        </PressScale>
      </View>

      <Text style={styles.help}>
        Set when this card should appear on the calendar and reminders.
      </Text>

      <View style={styles.quickRow}>
        <PressScale testID="due-today" onPress={() => applyQuick('today')} style={styles.quickBtn}>
          <Text style={styles.quickText}>Today 18:00</Text>
        </PressScale>

        <PressScale testID="due-tomorrow" onPress={() => applyQuick('tomorrow')} style={styles.quickBtn}>
          <Text style={styles.quickText}>Tomorrow 09:00</Text>
        </PressScale>

        <PressScale testID="due-weekend" onPress={() => applyQuick('weekend')} style={styles.quickBtn}>
          <Text style={styles.quickText}>Weekend</Text>
        </PressScale>
      </View>

      <Text style={styles.label}>Date</Text>
      <TextInput
        testID="due-date-input"
        value={dateText}
        onChangeText={setDateText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={UI.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />

      <Text style={styles.label}>Time</Text>
      <View style={styles.timeInputWrap}>
        <Clock color={UI.muted} size={14} />
        <TextInput
          testID="due-time-input"
          value={timeText}
          onChangeText={setTimeText}
          placeholder="HH:mm"
          placeholderTextColor={UI.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.timeInput}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <PressScale testID="clear-due-date" onPress={clear} style={styles.clearBtn}>
          <CalendarX color={UI.muted} size={15} />
          <Text style={styles.clearText}>Clear</Text>
        </PressScale>

        <PressScale testID="save-due-date" onPress={save} style={styles.saveBtn}>
          <Text style={styles.saveText}>Use date</Text>
        </PressScale>
      </View>
    </KeyboardAwareBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: UI.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: UI.line,
    padding: 24,
    paddingBottom: 130,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: UI.text,
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 26,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: UI.line,
  },
  help: {
    color: UI.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  quickBtn: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: UI.orange,
    backgroundColor: UI.orangeSoft,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  quickText: {
    color: UI.orange,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: UI.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: UI.soft,
    borderWidth: 1,
    borderColor: UI.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: UI.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  timeInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: UI.soft,
    borderWidth: 1,
    borderColor: UI.line,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  timeInput: {
    flex: 1,
    paddingVertical: 12,
    color: UI.text,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  error: {
    marginTop: 10,
    color: UI.danger,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  clearBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: UI.line,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  clearText: {
    color: UI.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: UI.orange,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: UI.card,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
