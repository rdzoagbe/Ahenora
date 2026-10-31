import type { ImageSourcePropType } from 'react-native';

/**
 * The artwork at the top of Home: one scene per kind of household, each in a
 * day and a night version (Roland, 2026-10-31: "we have targeted people
 * without kids and single parents too, we might have to change the image").
 *
 * Only pictures the household holds the rights to use in an app it sells go
 * here. Roland makes them himself, in his own account, with the prompts agreed
 * on 2026-10-31; the terms of the tool he uses decide whether that is allowed,
 * and the record of each file is kept beside it. While a scene has no picture
 * at all, Home shows the drawing made in code in components/HomeHero.tsx if
 * the scene has children in it, and no picture otherwise.
 *
 * To drop a picture in: add the file under assets/images and point the entry
 * at it with require('../assets/images/<file>').
 */
export const HERO_SCENES = ['family', 'children', 'mum', 'dad', 'grandparent', 'couple', 'solo'] as const;
export type HeroScene = (typeof HERO_SCENES)[number];

/** Scenes with children in them: the ones the drawing made in code can stand in for. */
export const SCENES_WITH_CHILDREN: readonly HeroScene[] = ['family', 'children', 'mum', 'dad', 'grandparent'];

type Art = { light: ImageSourcePropType | null; dark: ImageSourcePropType | null };

// Made by Roland in ChatGPT, his own account, on 2026-10-31; the record of
// each file is in assets/images/home/README.md. A slot still null is a picture
// not made yet.
export const HOME_HERO_ART: Record<HeroScene, Art> = {
  family: { light: require('../assets/images/home/home-family-light.webp'), dark: null },
  children: { light: require('../assets/images/home/home-children-light.webp'), dark: null },
  mum: { light: require('../assets/images/home/home-mum-light.webp'), dark: null },
  dad: { light: require('../assets/images/home/home-dad-light.webp'), dark: null },
  grandparent: { light: null, dark: require('../assets/images/home/home-grandparent-dark.webp') },
  couple: { light: require('../assets/images/home/home-couple-light.webp'), dark: null },
  solo: {
    light: require('../assets/images/home/home-solo-light.webp'),
    dark: require('../assets/images/home/home-solo-dark.webp'),
  },
};

/**
 * The picture for a scene in the current mode. A scene with only its day or
 * only its night picture shows that one in both modes: a real picture at the
 * wrong time of day is better than the stand-in drawing.
 */
export function heroArtFor(scene: HeroScene, dark: boolean): ImageSourcePropType | null {
  const art = HOME_HERO_ART[scene];
  return (dark ? art.dark ?? art.light : art.light ?? art.dark) ?? null;
}

/** Whether a scene has something to show: its artwork, or the stand-in drawing. */
export function heroHasPicture(scene: HeroScene, dark: boolean): boolean {
  return !!heroArtFor(scene, dark) || SCENES_WITH_CHILDREN.includes(scene);
}
