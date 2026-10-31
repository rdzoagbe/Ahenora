import type { ImageSourcePropType } from 'react-native';

/**
 * The artwork at the top of Home: one scene per kind of household, each in a
 * day and a night version (Roland, 2026-10-31: "we have targeted people
 * without kids and single parents too, we might have to change the image").
 *
 * Every entry is null until there is a picture the household holds the rights
 * to use in an app it sells. Roland generates them himself, in his own
 * account, with the prompts agreed on 2026-10-31; the terms of the tool he
 * uses decide whether that is allowed, and a note of the tool, the date and
 * the prompt is kept beside each file. While a scene is null, Home shows the
 * drawing made in code in components/HomeHero.tsx if the scene has children
 * in it, and no picture otherwise.
 *
 * To drop a picture in: add the file under assets/images and point the entry
 * at it with require('../assets/images/<file>').
 */
export const HERO_SCENES = ['family', 'children', 'mum', 'dad', 'grandparent', 'couple', 'solo'] as const;
export type HeroScene = (typeof HERO_SCENES)[number];

/** Scenes with children in them: the ones the drawing made in code can stand in for. */
export const SCENES_WITH_CHILDREN: readonly HeroScene[] = ['family', 'children', 'mum', 'dad', 'grandparent'];

type Art = { light: ImageSourcePropType | null; dark: ImageSourcePropType | null };

export const HOME_HERO_ART: Record<HeroScene, Art> = {
  family: { light: null, dark: null },
  children: { light: null, dark: null },
  mum: { light: null, dark: null },
  dad: { light: null, dark: null },
  grandparent: { light: null, dark: null },
  couple: { light: null, dark: null },
  solo: { light: null, dark: null },
};

/** Whether a scene has something to show: its artwork, or the stand-in drawing. */
export function heroHasPicture(scene: HeroScene, dark: boolean): boolean {
  const art = HOME_HERO_ART[scene];
  return !!(dark ? art.dark : art.light) || SCENES_WITH_CHILDREN.includes(scene);
}
