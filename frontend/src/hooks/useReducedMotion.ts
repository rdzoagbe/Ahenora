import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the person has asked their phone for less motion (iOS "Reduce
 * Motion", Android "Remove animations", the browser's prefers-reduced-motion).
 * Every movement in src/components/Motion.tsx stands still when this is on.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { if (alive) setReduced(!!value); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => setReduced(!!value));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}
