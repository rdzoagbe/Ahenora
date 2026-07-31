import { Alert, AlertButton, Platform } from 'react-native';

/**
 * react-native-web ships Alert.alert as a NO-OP: every confirmation dialog
 * in the app — delete invite, remove member, clear list — silently did
 * nothing on web while working fine on Android. Field report: "the delete
 * button doesn't work". One patch here fixes all ~78 call sites at once by
 * mapping RN alerts onto the browser's native dialogs:
 *
 *   no buttons / one button  -> window.alert, then the button's onPress
 *   two buttons              -> window.confirm; OK = the non-cancel action
 *   three or more            -> numbered window.prompt picker
 *
 * Imported once from the root layout for its side effect.
 */
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  (Alert as { alert: typeof Alert.alert }).alert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
  ) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    try {
      if (!buttons || buttons.length === 0) {
        window.alert(text);
        return;
      }
      if (buttons.length === 1) {
        window.alert(text);
        buttons[0].onPress?.();
        return;
      }
      if (buttons.length === 2) {
        const action = buttons.find((b) => b.style !== 'cancel') || buttons[1];
        const cancel = buttons.find((b) => b.style === 'cancel');
        if (window.confirm(text)) action.onPress?.();
        else cancel?.onPress?.();
        return;
      }
      const choices = buttons
        .map((b, i) => `${i + 1}) ${b.text || '...'}`)
        .join('\n');
      const raw = window.prompt(`${text}\n\n${choices}`, '');
      const index = raw ? parseInt(raw, 10) - 1 : -1;
      const picked = index >= 0 && index < buttons.length ? buttons[index] : null;
      if (picked && picked.style !== 'cancel') picked.onPress?.();
      else buttons.find((b) => b.style === 'cancel')?.onPress?.();
    } catch {
      // A broken dialog must never take the calling flow down with it.
    }
  };
}
