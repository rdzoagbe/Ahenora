/**
 * A face somebody recognises as their own.
 *
 * The app drew four people — man, woman, boy, girl — and every one of them
 * wore the same hair: `724133`, one fixed brown, straight. Only the SKIN was
 * variable. So a Black household could choose the deepest tone on offer and
 * get their own face back under somebody else's hair, and the app would look
 * like it had a choice in it while having almost none.
 *
 * Roland asked for "all type of races, black, white, mixed, asian etc". That
 * is not a skin-tone slider. Hair is not a detail of a face; it is most of
 * what makes one recognisable across the range of people who use a family app.
 *
 * The part that needs guarding hardest is not the new choices — it is that
 * nobody's existing picture changes underneath them. Households have already
 * chosen; a stored value written before tones existed, or before hair did,
 * must still render exactly what it rendered on the day it was saved.
 */
import {
  AVATAR_KINDS, LEGACY_KINDS, SKIN_TONES, HAIR_COLOURS,
  DEFAULT_TONE, DEFAULT_HAIR, avatarValue, parseAvatar, hasHairColour,
} from '../avatarValue';
import { AVATAR_ART, SKIN_TOKEN, HAIR_TOKEN } from '../avatarArt';

describe('the drawings cover more than one kind of hair', () => {
  it('offers textured hair, not only straight', () => {
    for (const kind of ['coils', 'locs', 'curls'] as const) {
      expect(AVATAR_KINDS).toContain(kind);
    }
  });

  it('offers a hijab, because households wear one', () => {
    expect(AVATAR_KINDS).toContain('hijab');
  });

  it('every offered drawing actually exists', () => {
    for (const kind of AVATAR_KINDS) {
      expect(typeof AVATAR_ART[kind]).toBe('string');
      expect(AVATAR_ART[kind].length).toBeGreaterThan(500);
    }
  });

  it('hair colour is a token wherever there is hair, not a fixed brown', () => {
    // The specific fault: the hex was baked in, so no amount of skin tone
    // could give somebody their own hair.
    for (const kind of [...AVATAR_KINDS, ...LEGACY_KINDS]) {
      expect(AVATAR_ART[kind]).toContain(SKIN_TOKEN);
      expect(AVATAR_ART[kind]).not.toContain('#724133');
      if (hasHairColour(kind)) expect(AVATAR_ART[kind]).toContain(HAIR_TOKEN);
    }
  });

  it('the hijab has no hair colour, and the picker knows it', () => {
    // It is a garment. Offering hair swatches over it would be a control with
    // nothing to change.
    expect(hasHairColour('hijab')).toBe(false);
    for (const kind of ['coils', 'locs', 'curls', 'waves', 'short', 'long', 'bun'] as const) {
      expect(hasHairColour(kind)).toBe(true);
    }
  });

  it('no drawing wears a colour from outside the app’s palette', () => {
    // The hijab shipped in DiceBear's default mint until it was set
    // deliberately — a colour belonging to no palette this app uses.
    for (const kind of AVATAR_KINDS) {
      expect(AVATAR_ART[kind]).not.toContain('a7ffc4');
    }
  });

  it('offers a grey, because this app has grandparents in it', () => {
    expect(HAIR_COLOURS).toContain('b0b0b0');
  });

  it('offers black hair, the most common on earth and the one it could not draw', () => {
    expect(HAIR_COLOURS[0]).toBe('1a1a1a');
  });
});

describe('nobody’s existing picture changes underneath them', () => {
  it('a value from before tones existed still renders', () => {
    expect(parseAvatar('illus:girl')).toEqual({
      kind: 'girl', tone: DEFAULT_TONE, hair: DEFAULT_HAIR,
    });
  });

  it('a value from before hair existed keeps the brown it was drawn in', () => {
    const parsed = parseAvatar('illus:woman:3');
    expect(parsed).toEqual({ kind: 'woman', tone: 3, hair: DEFAULT_HAIR });
    // And that default IS the old fixed colour, so the picture is unchanged.
    expect(HAIR_COLOURS[DEFAULT_HAIR]).toBe('724133');
  });

  it('the retired drawings are still drawn', () => {
    for (const kind of LEGACY_KINDS) {
      expect(typeof AVATAR_ART[kind]).toBe('string');
    }
  });

  it('but they are no longer offered in the picker', () => {
    for (const kind of LEGACY_KINDS) {
      expect(AVATAR_KINDS).not.toContain(kind);
    }
  });
});

describe('a stored value survives a round trip', () => {
  it('keeps all three parts', () => {
    expect(parseAvatar(avatarValue('locs', 4, 0)))
      .toEqual({ kind: 'locs', tone: 4, hair: 0 });
  });

  it('refuses a drawing it does not have', () => {
    expect(parseAvatar('illus:nonesuch:1:1')).toBeNull();
  });

  it('leaves a photo URL alone', () => {
    expect(parseAvatar('https://example.com/me.jpg')).toBeNull();
  });

  it('falls back rather than crashing on nonsense indexes', () => {
    // These come from a database, not from this code.
    expect(parseAvatar('illus:coils:99:99'))
      .toEqual({ kind: 'coils', tone: DEFAULT_TONE, hair: DEFAULT_HAIR });
    expect(parseAvatar('illus:coils:-1:x'))
      .toEqual({ kind: 'coils', tone: DEFAULT_TONE, hair: DEFAULT_HAIR });
  });

  it('every index the picker can produce is in range', () => {
    for (let t = 0; t < SKIN_TONES.length; t += 1) {
      for (let h = 0; h < HAIR_COLOURS.length; h += 1) {
        expect(parseAvatar(avatarValue('coils', t, h))).toEqual({
          kind: 'coils', tone: t, hair: h,
        });
      }
    }
  });
});
