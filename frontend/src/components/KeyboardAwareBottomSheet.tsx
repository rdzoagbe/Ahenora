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
};

export default function KeyboardAwareBottomSheet({
  visible,
  onClose,
  children,
  keyboardVerticalOffset = 0,
  backdropStyle,
  contentStyle,
}: KeyboardAwareBottomSheetProps) {
  const { theme } = useStore();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={[styles.backdrop, backdropStyle]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.content,
                { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder },
                contentStyle,
              ]}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
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
});
