import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  TouchableWithoutFeedback,
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

  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      // In the footer layout the card is height-bounded; the scroll must be
      // allowed to shrink so the pinned footer always keeps its space.
      style={footer ? styles.scrollShrink : undefined}
      contentContainerStyle={[
        styles.content,
        { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder },
        contentStyle,
        // With a pinned footer the scroll area no longer owns the bottom of the
        // sheet, so drop its own rounding and heavy bottom padding.
        footer ? styles.contentWithFooter : null,
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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={[styles.backdrop, backdropStyle]}>
            {footer ? (
              // Card wraps scroll + a pinned footer so the primary action stays
              // visible however long the list is.
              <View
                style={[
                  styles.footerCard,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder },
                ]}
              >
                {scroll}
                <View
                  style={[
                    styles.footer,
                    { backgroundColor: theme.colors.card, borderTopColor: theme.colors.cardBorder },
                  ]}
                >
                  {footer}
                </View>
              </View>
            ) : (
              scroll
            )}
          </View>
        </TouchableWithoutFeedback>
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
  // When a footer is pinned, the scroll area sits inside footerCard: no top
  // rounding of its own, and just enough bottom padding to clear the footer.
  contentWithFooter: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderWidth: 0,
    paddingBottom: 20,
  },
  footerCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  scrollShrink: {
    flexShrink: 1,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    // Clear the Android system nav bar so the button is never half-hidden.
    paddingBottom: 28,
  },
});
