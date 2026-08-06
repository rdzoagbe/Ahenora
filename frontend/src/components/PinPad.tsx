import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Delete } from 'lucide-react-native';

import { PressScale } from './PressScale';

/**
 * Four digits, entered without the system keyboard.
 *
 * The app has two places that ask for a PIN, and for a long time they did it
 * two different ways: this pad, and a plain `TextInput` that raises Android's
 * numeric keypad. The second is where the trouble was. A sheet anchored to the
 * bottom of the screen puts its confirm button exactly where the system keypad
 * appears, and getting it clear means knowing how tall that keypad is —
 * a number Android does not reliably report. Two separate fixes were built on
 * that measurement and both failed on a real phone, because the measurement
 * came back zero and the button stayed buried under the keys.
 *
 * So the measurement is gone. Nothing can cover the button if nothing appears
 * over the app: these are ordinary views inside the sheet, laid out by the same
 * rules as everything else on screen, and the sheet is exactly as tall as it
 * looks. It is also the better thing for the moment it belongs to — a parent
 * handing a tablet to a child, one-handed, wanting four big targets rather than
 * a text field.
 *
 * Presentational on purpose: the caller owns the digits, so it also owns what
 * "complete" means and what happens next.
 */
export type PinPadColors = {
  text: string;
  muted: string;
  line: string;
  danger: string;
};

export function PinPad({
  pin,
  onDigit,
  onBack,
  colors,
  error,
  disabled,
}: {
  pin: string;
  onDigit: (d: string) => void;
  onBack: () => void;
  colors: PinPadColors;
  error?: string | null;
  disabled?: boolean;
}) {
  return (
    <View>
      <View style={styles.dotsRow}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: colors.line },
              i < pin.length && { backgroundColor: colors.text, borderColor: colors.text },
              error ? { borderColor: colors.danger } : undefined,
            ]}
          />
        ))}
      </View>

      {error ? <Text style={[styles.errText, { color: colors.danger }]}>{error}</Text> : null}

      <View style={styles.pad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <PressScale
            key={d}
            testID={`pin-${d}`}
            accessibilityRole="button"
            accessibilityLabel={d}
            disabled={disabled}
            onPress={() => onDigit(d)}
            style={styles.key}
          >
            <Text style={[styles.keyText, { color: colors.text }]}>{d}</Text>
          </PressScale>
        ))}
        <View style={styles.key} />
        <PressScale
          testID="pin-0"
          accessibilityRole="button"
          accessibilityLabel="0"
          disabled={disabled}
          onPress={() => onDigit('0')}
          style={styles.key}
        >
          <Text style={[styles.keyText, { color: colors.text }]}>0</Text>
        </PressScale>
        <PressScale
          testID="pin-back"
          accessibilityRole="button"
          disabled={disabled}
          onPress={onBack}
          style={styles.key}
        >
          <Delete color={colors.muted} size={22} />
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dotsRow: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 22, marginBottom: 10 },
  dot: { width: 14, height: 14, borderRadius: 9999, borderWidth: 1.5 },
  errText: { textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  // Wide rather than square: three rows of keys plus a header has to fit above
  // the fold on a short phone, and this is the dimension there is slack in.
  key: { width: '33.333%', aspectRatio: 1.6, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: 'Inter_500Medium', fontSize: 26 },
});
