import { AVATAR_ART, HAIR_TOKEN } from './avatarArt';

/**
 * What a person's picture IS, as a value — separate from the component that
 * draws it.
 *
 * Pulled out of PersonAvatar.tsx on 2026-09-09 so the rules can be tested
 * without a React Native runtime. They are the rules most worth testing: they
 * decide whether a picture a household chose two months ago still renders as
 * the picture they chose.
 */
/**
 * The drawings offered, in the order they are shown.
 *
 * These used to be `man, woman, boy, girl`, all four wearing the same fixed
 * brown hair. Only the skin was variable — so a Black household could pick a
 * deep tone and get their own face back under somebody else's hair, which is
 * representation in name and not in fact. The axis is now HAIR: coils, locs,
 * curls, waves, straight, long, a bun and a hijab, each in any skin tone and
 * any hair colour.
 */
export const AVATAR_KINDS = [
  'coils', 'locs', 'curls', 'waves', 'short', 'long', 'bun', 'hijab',
] as const;

/**
 * Still drawn, no longer offered. Households picked these before today and a
 * picture that silently turns back into a letter is worse than one that is
 * merely no longer in the picker.
 */
export const LEGACY_KINDS = ['man', 'woman', 'boy', 'girl'] as const;

export type AvatarKind = typeof AVATAR_KINDS[number] | typeof LEGACY_KINDS[number];

const KNOWN_KINDS: readonly string[] = [...AVATAR_KINDS, ...LEGACY_KINDS];

/**
 * Five tones rather than the two that were asked for. It costs one hex each —
 * the drawing is identical and the tone is a string replace — and two tones
 * makes a household pick the nearer of two, which is worse than not offering
 * the choice at all.
 */
export const SKIN_TONES = ['ffdbb4', 'edb98a', 'd08b5b', 'ae5d29', '614335'] as const;
export const DEFAULT_TONE = 1;

/**
 * Hair colours. Black first because it is the most common hair colour on
 * earth and was the one the app could not draw at all.
 *
 * Grey is here on purpose: this app has grandparents in it — they are a role
 * the invite flow offers — and a household that adds one should not have to
 * give them somebody else's hair.
 */
export const HAIR_COLOURS = ['1a1a1a', '3d2b1f', '724133', 'a55728', 'd6b370', 'b0b0b0'] as const;
/** Index of `724133`, the brown every drawing used to be fixed at, so a row
 *  stored before hair was a choice renders exactly as it always did. */
export const DEFAULT_HAIR = 2;

/** Stored as `illus:<kind>`, `illus:<kind>:<tone>` or `illus:<kind>:<tone>:<hair>`,
 *  so a photo URL still reads as a URL. Each part is optional going backwards:
 *  every shape ever written stays readable. */
export const ILLUS_PREFIX = 'illus:';

export function avatarValue(kind: AvatarKind, tone: number, hair: number): string {
  return `${ILLUS_PREFIX}${kind}:${tone}:${hair}`;
}

function inRange(raw: string | undefined, length: number, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < length ? n : fallback;
}

/**
 * Parses a stored value.
 *
 * Tone and hair are both optional, and deliberately so: rows exist that were
 * written before tones were a choice, and more that were written before hair
 * was. Each older shape falls back to what that row actually looked like on
 * the day it was saved, so nobody's picture changes underneath them.
 */
export function parseAvatar(
  value?: string | null,
): { kind: AvatarKind; tone: number; hair: number } | null {
  if (!value || !value.startsWith(ILLUS_PREFIX)) return null;
  const [kind, rawTone, rawHair] = value.slice(ILLUS_PREFIX.length).split(':');
  if (!KNOWN_KINDS.includes(kind)) return null;
  return {
    kind: kind as AvatarKind,
    tone: inRange(rawTone, SKIN_TONES.length, DEFAULT_TONE),
    hair: inRange(rawHair, HAIR_COLOURS.length, DEFAULT_HAIR),
  };
}

/** Back-compat name for callers that only need to know an illustration is set. */
export function avatarKind(value?: string | null): AvatarKind | null {
  return parseAvatar(value)?.kind ?? null;
}

/**
 * Whether the hair-colour choice does anything to this drawing.
 *
 * A hijab is a garment, not hair: its drawing carries no hair colour, so
 * offering the swatches over it would be a control with nothing to change —
 * the same reason the tones are hidden until a drawing is picked at all.
 */
export function hasHairColour(kind: AvatarKind): boolean {
  return AVATAR_ART[kind]?.includes(HAIR_TOKEN) ?? false;
}
