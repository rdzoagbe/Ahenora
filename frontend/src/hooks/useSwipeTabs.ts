import { useCallback, useRef } from 'react';
import { Animated, Dimensions } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Gesture } from 'react-native-gesture-handler';

const TAB_ORDER = ['/feed', '/calendar', '/kids', '/vault', '/settings'] as const;
const SWIPE_THRESHOLD = 60;
const VELOCITY_THRESHOLD = 500;
const DRAG_RESISTANCE = 0.35;

export function useSwipeTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const translateX = useRef(new Animated.Value(0)).current;
  const isNavigating = useRef(false);
  const screenWidth = Dimensions.get('window').width;

  const getCurrentIndex = useCallback(() => {
    return TAB_ORDER.findIndex(
      (tab) => pathname === tab || pathname.endsWith(tab.slice(1)),
    );
  }, [pathname]);

  const gesture = Gesture.Pan()
    .activeOffsetX([-25, 25])
    .failOffsetY([-10, 10])
    .minDistance(20)
    .onUpdate((e) => {
      if (isNavigating.current) return;
      const currentIndex = getCurrentIndex();
      const atStart = currentIndex <= 0 && e.translationX > 0;
      const atEnd = currentIndex >= TAB_ORDER.length - 1 && e.translationX < 0;
      const resistance = atStart || atEnd ? DRAG_RESISTANCE * 0.2 : DRAG_RESISTANCE;
      translateX.setValue(e.translationX * resistance);
    })
    .onEnd((e) => {
      if (isNavigating.current) return;
      const currentIndex = getCurrentIndex();
      if (currentIndex === -1) {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 0 }).start();
        return;
      }

      const swipedLeft = e.translationX < -SWIPE_THRESHOLD && e.velocityX < -VELOCITY_THRESHOLD;
      const swipedRight = e.translationX > SWIPE_THRESHOLD && e.velocityX > VELOCITY_THRESHOLD;

      const nextIndex = swipedLeft
        ? currentIndex + 1
        : swipedRight
          ? currentIndex - 1
          : -1;

      if (nextIndex < 0 || nextIndex >= TAB_ORDER.length) {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 4 }).start();
        return;
      }

      isNavigating.current = true;

      Animated.timing(translateX, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start(() => {
        router.navigate(`/(tabs)${TAB_ORDER[nextIndex]}` as any);
        translateX.setValue(0);
        isNavigating.current = false;
      });
    });

  return { gesture, translateX };
}
