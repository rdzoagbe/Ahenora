import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How much of the screen the keyboard is currently covering.
 *
 * A bottom-anchored sheet does not move out of the keyboard's way on its own.
 * The PIN field for handing a device to a child sat at the very bottom of
 * such a sheet, so tapping it opened the keypad directly on top of the thing
 * you were trying to type into — the field was there, underneath, invisible.
 *
 * Measured rather than inferred. KeyboardAvoidingView needs different
 * behaviours per platform and, on Android, agrees with the window resize mode
 * only when that is configured to match; this app sets no
 * softwareKeyboardLayoutMode, so relying on that would be relying on a
 * default. The height the OS reports is the same on both.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it animates, which lets the sheet
    // travel with it; Android only reports it once it has arrived.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) =>
      setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
