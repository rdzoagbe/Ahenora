import React, { useState } from 'react';
import { StyleSheet, TextInput, TextInputProps, View, ViewStyle, StyleProp } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { PressScale } from './PressScale';

interface Props extends TextInputProps {
  /** Layout/margins for the field as a whole (the input's box style goes on `style`). */
  containerStyle?: StyleProp<ViewStyle>;
  eyeColor?: string;
  /** Start with the password visible (e.g. a sign-up field with a strength meter). */
  initiallyVisible?: boolean;
  /** Accessibility labels for the two toggle states. */
  showLabel?: string;
  hideLabel?: string;
}

/**
 * A password field with a show/hide eye at its right edge.
 *
 * The input keeps whatever box styling the screen already used (passed via
 * `style`); this only overlays the eye and reserves room for it so the text
 * never runs underneath. Any margins belong on `containerStyle`, so the eye
 * stays centred on the input rather than on the margin box.
 */
export function PasswordInput({
  containerStyle,
  style,
  eyeColor = '#8A8178',
  initiallyVisible = false,
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  ...rest
}: Props) {
  const [show, setShow] = useState(initiallyVisible);
  return (
    <View style={[styles.wrap, containerStyle]}>
      <TextInput
        {...rest}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        style={[style, styles.input]}
      />
      <PressScale
        testID="password-eye"
        accessibilityRole="button"
        accessibilityLabel={show ? hideLabel : showLabel}
        onPress={() => setShow((s) => !s)}
        hitSlop={10}
        style={styles.eye}
      >
        {show ? <EyeOff color={eyeColor} size={20} /> : <Eye color={eyeColor} size={20} />}
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  // Room for the eye so the last characters never hide under it.
  input: { paddingRight: 46 },
  eye: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 4 },
});
