import { useRef } from 'react';
import { PanResponder, PanResponderGestureState } from 'react-native';
import { useRouter, usePathname } from 'expo-router';

const TAB_ORDER = ['/feed', '/calendar', '/kids', '/vault', '/settings'] as const;
const SWIPE_THRESHOLD = 60;
const VELOCITY_THRESHOLD = 0.3;

export function useSwipeTabs() {
  const router = useRouter();
  const pathname = usePathname();

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gs: PanResponderGestureState) => {
        return Math.abs(gs.dx) > 20 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5;
      },
      onPanResponderRelease: (_evt, gs: PanResponderGestureState) => {
        const isSwipe =
          Math.abs(gs.dx) > SWIPE_THRESHOLD ||
          Math.abs(gs.vx) > VELOCITY_THRESHOLD;
        if (!isSwipe) return;

        const currentIndex = TAB_ORDER.findIndex(
          (tab) => pathname === tab || pathname.endsWith(tab.slice(1))
        );
        if (currentIndex === -1) return;

        const nextIndex = gs.dx < 0 ? currentIndex + 1 : currentIndex - 1;
        if (nextIndex < 0 || nextIndex >= TAB_ORDER.length) return;

        router.navigate(`/(tabs)${TAB_ORDER[nextIndex]}` as any);
      },
    })
  ).current;

  return panResponder.panHandlers;
}
