/**
 * Generates frontend/src/avatarArt.ts — the four house illustrations, as SVG.
 *
 * Run by hand when the recipes below change; the output is committed. The app
 * does NOT depend on DiceBear at runtime, which is the whole point: shipping
 * the library would pull every avatar style it ships into the bundle to use
 * one, and the art is what we want, not the generator.
 *
 *     cd scripts && npm i --no-save @dicebear/core@10 @dicebear/collection@9
 *     node gen_avatars.mjs
 *
 * Art: Avataaars by Pablo Stanley (https://avataaars.com), free for personal
 * and commercial use — no attribution required, unlike most of the other
 * DiceBear styles, which is why this one was chosen for a paid app.
 *
 * Skin tone is a single hex in the output, verified by generating two tones
 * and diffing: swapping the hex reproduces the other tone byte for byte. So
 * four drawings plus a string replace give all twenty combinations, instead of
 * twenty drawings at ~5KB each.
 */
import { writeFileSync } from 'node:fs';
import { createAvatar } from '@dicebear/core';
import { avataaars } from '@dicebear/collection';

const SKIN_TOKEN = '__SKIN__';
const HAIR_TOKEN = '__HAIR__';
const SKIN_SEED = 'edb98a';   // replaced by the token below
const HAIR_SEED = '724133';   // likewise — hair AND beard carry this hex

// The people the app draws.
//
// Until 2026-09-09 there were four — man, woman, boy, girl — and every one of
// them wore the same fixed brown hair, `724133`, straight and European. Only
// the SKIN was variable. So a Black household could pick a deep tone and get
// back their own face under somebody else's hair, which is representation in
// name and not in fact. Roland asked for "all type of races, black, white,
// mixed, asian etc" and this is what that actually requires: hair is not a
// detail of a face, it is most of what makes one recognisable.
//
// So the axis is now HAIR, not gender, and its colour is a token like the skin
// is. Coils, locs, curls, waves, straight, long, a bun and a hijab — chosen to
// cover the range of people who use a family app rather than to be exhaustive.
// One of them wears a beard, which is the only reason the old `man` existed.
//
// The four original keys are still generated, unchanged, further down: rows
// already in households point at them and must keep rendering.
const PEOPLE = {
  coils: { top: 'fro',                 shirt: '2f5d57', clothing: 'shirtCrewNeck',  beard: false },
  locs:  { top: 'dreads',              shirt: 'b4553f', clothing: 'shirtCrewNeck',  beard: false },
  curls: { top: 'shortCurly',          shirt: '3f6e9e', clothing: 'shirtCrewNeck',  beard: false },
  waves: { top: 'shortWaved',          shirt: '8a5ba6', clothing: 'shirtCrewNeck',  beard: true },
  short: { top: 'shortFlat',           shirt: '2f5d57', clothing: 'blazerAndShirt', beard: false },
  long:  { top: 'longButNotTooLong',   shirt: 'b4553f', clothing: 'blazerAndShirt', beard: false },
  bun:   { top: 'bun',                 shirt: '3f6e9e', clothing: 'shirtCrewNeck',  beard: false },
  // A hijab is a garment, not hair, so it carries no hair colour and the
  // picker hides that row for it — a control that changes nothing is worse
  // than no control. Its own colour is set here rather than left to the
  // library's default mint, which belongs to no palette this app uses.
  hijab: { top: 'hijab', shirt: '2f5d57', clothing: 'shirtCrewNeck', beard: false, hat: 'b4553f' },

  // Kept exactly as they were. A household that chose one of these before
  // today still has it stored, and a picture that silently turns into a letter
  // is worse than a picture that is merely no longer offered.
  man:   { top: 'shortFlat',         shirt: '2f5d57', clothing: 'shirtCrewNeck',  beard: true },
  woman: { top: 'longButNotTooLong', shirt: 'b4553f', clothing: 'blazerAndShirt', beard: false },
  boy:   { top: 'shortCurly',        shirt: '3f6e9e', clothing: 'shirtCrewNeck',  beard: false },
  girl:  { top: 'straight02',        shirt: '8a5ba6', clothing: 'shirtCrewNeck',  beard: false },
};

const draw = (who) => {
  const p = PEOPLE[who];
  const svg = createAvatar(avataaars, {
    seed: who,
    skinColor: [SKIN_SEED],
    top: [p.top],
    hairColor: [HAIR_SEED],
    facialHair: p.beard ? ['beardLight'] : [],
    facialHairProbability: p.beard ? 100 : 0,
    facialHairColor: [HAIR_SEED],
    ...(p.hat ? { hatColor: [p.hat] } : {}),
    clothing: [p.clothing],
    clothesColor: [p.shirt],
    eyes: ['happy'],
    eyebrows: ['defaultNatural'],
    mouth: ['smile'],
    accessoriesProbability: 0,
  }).toString();
  return svg
    // The metadata block is ~1.5KB of RDF per drawing and renders nothing.
    .replace(/<metadata[\s\S]*?<\/metadata>/, '')
    .replaceAll(SKIN_SEED, SKIN_TOKEN)
    .replaceAll(SKIN_SEED.toUpperCase(), SKIN_TOKEN)
    .replaceAll(HAIR_SEED, HAIR_TOKEN)
    .replaceAll(HAIR_SEED.toUpperCase(), HAIR_TOKEN);
};

const entries = Object.keys(PEOPLE)
  .map((who) => `  ${who}: ${JSON.stringify(draw(who))},`)
  .join('\n');

writeFileSync(
  new URL('../frontend/src/avatarArt.ts', import.meta.url),
  `// GENERATED by scripts/gen_avatars.mjs — do not edit by hand.
//
// Avataaars by Pablo Stanley (https://avataaars.com), free for personal and
// commercial use. Each drawing carries one skin colour, written here as the
// tokens ${SKIN_TOKEN} and ${HAIR_TOKEN}, so a tone or a hair colour is a
// string replace rather than another copy of the same picture. Hair used to be
// a fixed brown, which meant a dark skin tone still came back under straight
// European hair.

export const SKIN_TOKEN = '${SKIN_TOKEN}';
export const HAIR_TOKEN = '${HAIR_TOKEN}';

export const AVATAR_ART: Record<string, string> = {
${entries}
};
`,
);
console.log('wrote frontend/src/avatarArt.ts');
