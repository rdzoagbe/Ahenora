import { Platform } from 'react-native';

/**
 * A yes/no prompt that works on web.
 *
 * `Alert.alert` renders nothing on React Native Web, so screens that used it
 * for confirmation took a `Platform.OS === 'web'` shortcut and just did the
 * thing. That is survivable for deleting a reward and not for deleting a
 * child, whose stars and entire history go with them.
 *
 * Returns false when there is no way to ask — better to decline a destructive
 * action than to perform it unasked.
 */
export function webConfirm(message: string): boolean {
  if (Platform.OS !== 'web') return false;
  const confirmFn = (globalThis as { confirm?: (m: string) => boolean }).confirm;
  if (typeof confirmFn !== 'function') return false;
  return confirmFn(message);
}
