import type { ImageSourcePropType } from 'react-native';

/**
 * The artwork at the top of Home, light and dark.
 *
 * Null until there is a picture the household holds the rights to use in an
 * app it sells: commissioned under a written contract, or bought under a
 * licence that covers in-app commercial use. Record where each file came from
 * next to it before it goes in. While these are null, Home shows the drawing
 * made in code in components/HomeHero.tsx.
 *
 * To drop the art in: add the two files under assets/images and point these at
 * them with require('../assets/images/<file>').
 */
export const HOME_HERO_ART: { light: ImageSourcePropType | null; dark: ImageSourcePropType | null } = {
  light: null,
  dark: null,
};
