import type { ImageSourcePropType } from 'react-native';

/**
 * The painting at the top of each part of the app, beside the page's title
 * (Roland, 2026-10-31: "not all the pages have the images"). Same painted
 * style as the Home pictures; made by Roland in ChatGPT, in his own account,
 * on 2026-10-31, with the record of each file in
 * assets/images/sections/README.md. A null slot is a picture still being made:
 * the page shows its header without one.
 */
export type Section = 'calendar' | 'family' | 'kitchen' | 'shopping' | 'vault' | 'settings';

export const SECTION_ART: Record<Section, ImageSourcePropType | null> = {
  calendar: require('../assets/images/sections/section-calendar.webp'),
  family: require('../assets/images/sections/section-family.webp'),
  kitchen: require('../assets/images/sections/section-kitchen.webp'),
  shopping: require('../assets/images/sections/section-shopping.webp'),
  // Being redone: the first version printed English words on the documents.
  vault: null,
  settings: require('../assets/images/sections/section-settings.webp'),
};
