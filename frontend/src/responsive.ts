import { useWindowDimensions } from 'react-native';

export const BP = { tablet: 600, desktop: 1024 } as const;

export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  const isWide = width >= BP.tablet;
  const isDesktop = width >= BP.desktop;
  const isTablet = isWide && !isDesktop;
  const isPhone = !isWide;

  // Sidebar width: full labels on desktop, icon-only on tablet, hidden on phone
  const sidebarW = isDesktop ? 220 : isWide ? 68 : 0;
  // Horizontal page padding
  const px = isDesktop ? 40 : isWide ? 28 : 20;
  // Max content width (centered on wide screens). On phones there is NO
  // constraint: width:'100%' already fits, and echoing the window width back
  // as maxWidth means a degenerate first-paint measurement (seen once on the
  // web export: the whole Feed squeezed into a ~90px column) becomes a
  // permanent layout collapse instead of a non-event.
  const maxW = isDesktop ? 1100 : isWide ? 820 : undefined;

  function pick<T>(phone: T, wide: T, desktop?: T): T {
    if (isDesktop && desktop !== undefined) return desktop;
    if (isWide) return wide;
    return phone;
  }

  return { width, height, isPhone, isTablet, isDesktop, isWide, sidebarW, px, maxW, pick };
}
