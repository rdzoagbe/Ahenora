import { useCallback, useEffect, useRef, useState } from 'react';
import { ToastTone } from '../components/AppToast';

export type ToastState = {
  message: string;
  tone: ToastTone;
  action?: { label: string; onPress: () => void };
};

/**
 * A single auto-dismissing toast.
 *
 * The timer is held in a ref and cleared before each new toast and on unmount.
 * Without that, a second toast raised while the first was still up left the
 * first timer running — so it could dismiss the newer toast early — and a
 * screen unmounted mid-toast set state on a gone component. Four screens each
 * carried their own timer-less copy of this; they now share it.
 */
export function useToast(duration = 2300) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const showToast = useCallback(
    (
      message: string,
      tone: ToastTone = 'info',
      // One optional way back. The capture bar decides where a typed line
      // goes, so a wrong guess has to cost a tap, not a hunt.
      action?: { label: string; onPress: () => void },
    ) => {
      clear();
      setToast({ message, tone, action });
      timer.current = setTimeout(() => setToast(null), duration);
    },
    [clear, duration],
  );

  useEffect(() => clear, [clear]);

  return { toast, showToast };
}
