import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useStore } from '../store';

type KeyboardAwareBottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  keyboardVerticalOffset?: number;
  backdropStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  // Optional pinned footer, rendered below the scroll area and always visible.
  // Use for a primary action (e.g. "Add all") that must not fall below the fold
  // when the scrolling content is tall. Sheets that don't pass one are
  // unchanged.
  footer?: React.ReactNode;
};

export default function KeyboardAwareBottomSheet({
  visible,
  onClose,
  children,
  keyboardVerticalOffset = 0,
  backdropStyle,
  contentStyle,
  footer,
}: KeyboardAwareBottomSheetProps) {
  const { theme } = useStore();

  // The scroll structure is deliberately identical with and without a footer:
  // an earlier attempt nested the ScrollView inside a height-bounded card and
  // relied on flex shrinking, which broke scrolling on Android. The footer is
  // an absolutely-positioned overlay instead, and the content keeps enough
  // bottom padding that the last row can always be scrolled clear of it.
  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[
        styles.content,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <View style={[styles.backdrop, backdropStyle]}>
          {/* Keyboard dismissal must NOT wrap the sheet: a Touchable around a
              ScrollView claims the JS responder on touch start, and on Android
              that blocks the native scroller from ever taking the gesture —
              every tall sheet froze. The dismiss target is an underlay behind
              the sheet instead (taps on the dark area only), and dragging the
              list dismisses the keyboard via keyboardDismissMode. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={Keyboard.dismiss}
            accessible={false}
          />
          {scroll}
          {footer ? (
            // Pinned as an overlay at the very bottom of the screen, over the
            // sheet, so the primary action stays visible however long the
            // list is — without touching the scroll layout at all.
            <View
              style={[
                styles.footer,
                { backgroundColor: theme.colors.card, borderTopColor: theme.colors.cardBorder },
              ]}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardRoot: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
    // Tall sheets grow to full height; keep them below the status bar so
    // titles never hide under the clock.
    paddingTop: 56,
  },
  content: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 120,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    // Clear the Android system nav bar so the button is never half-hidden.
    paddingBottom: 28,
  },
});
