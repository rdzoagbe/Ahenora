import { useCallback, useState } from 'react';
import { ToastTone } from '../components/AppToast';

export type ToastState = { message: string; tone: ToastTone };

export function useToast(duration = 2300) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      setToast({ message, tone });
      setTimeout(() => setToast(null), duration);
    },
    [duration],
  );

  return { toast, showToast };
}
