import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useStore } from '../store';
import { AVATAR_ART, SKIN_TOKEN, HAIR_TOKEN } from '../avatarArt';
import {
  AVATAR_KINDS, LEGACY_KINDS, SKIN_TONES, HAIR_COLOURS, DEFAULT_TONE, DEFAULT_HAIR,
  ILLUS_PREFIX, avatarValue, parseAvatar, avatarKind, hasHairColour, illustrationXml,
  type AvatarKind,
} from '../avatarValue';

// Re-exported so every existing caller keeps importing from where it always
// did; the definitions moved, the surface did not.
export {
  AVATAR_KINDS, LEGACY_KINDS, SKIN_TONES, HAIR_COLOURS, DEFAULT_TONE, DEFAULT_HAIR,
  ILLUS_PREFIX, avatarValue, parseAvatar, avatarKind, hasHairColour, illustrationXml,
};
export type { AvatarKind };

/**
 * The holder for a person's picture.
 *
 * Three things can sit in it, in order: one of the house illustrations, a
 * photo URL (Google sign-in already hands us one), or the initial. The
 * fallback matters — a household is half-set-up most of the time, and a blank
 * ring reads as a bug.
 *
 * Illustrations are drawn, not photographed, on purpose: nobody has to find a
 * picture of their eight-year-old to make the app look finished, and there is
 * no upload to store, moderate or delete.
 */
/**
 * A light ground behind the drawing, in both themes.
 *
 * Dark hair on the app's dark card was a silhouette against its own colour:
 * the afro and the bun read as bald. This is the frame of a photograph rather
 * than a patch of the page — deliberately one colour in light and dark mode,
 * because the drawing itself has no dark variant.
 */
const ILLUSTRATION_GROUND = '#F3EFE9';

function Illustration(
  { kind, tone, hair, size }: { kind: AvatarKind; tone: number; hair: number; size: number },
) {
  const xml = illustrationXml(kind, tone, hair);
  if (!xml) return null;
  return <SvgXml xml={xml} width={size} height={size} />;
}

export function PersonAvatar({
  name,
  avatar,
  size = 30,
  ring = true,
}: {
  name?: string | null;
  avatar?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const { theme } = useStore();
  const ui = theme.colors;
  const illus = parseAvatar(avatar);
  const isPhoto = !!avatar && !illus && /^https?:\/\//.test(avatar);
  const box = [
    styles.box,
    { width: size, height: size, borderRadius: size / 2, backgroundColor: ui.accentSoft },
    ring ? { borderWidth: 1.5, borderColor: ui.cardBorder } : null,
  ];

  if (illus) {
    return (
      // The light ground goes HERE and not on the shared `box`, because a
      // photo and an initial both belong on the page's own colours; only the
      // drawing needs a frame of its own to be seen against.
      <View style={[box, { backgroundColor: ILLUSTRATION_GROUND }]}>
        <Illustration kind={illus.kind} tone={illus.tone} hair={illus.hair} size={size} />
      </View>
    );
  }
  if (isPhoto) {
    return (
      <View style={box}>
        <Image source={{ uri: avatar! }} style={{ width: size, height: size }} />
      </View>
    );
  }
  return (
    <View style={box}>
      {/* text, not accentInk: the initial renders at 13px inside a 30px ring,
          and the brand ink on its own tint measures 4.47:1 — a hair under AA
          for text this small. The ring already carries the accent. */}
      <Text style={[styles.initial, { color: ui.text, fontSize: Math.round(size * 0.42) }]}>
        {(name || '?').trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * Two axes, not twenty tiles.
 *
 * Who you are and what you look like are separate questions, so the picker
 * asks them separately: four people on one row, five tones on the next. A
 * twenty-tile grid would be the same information laid out as a puzzle.
 */
export function AvatarPicker({
  name,
  value,
  onPick,
  busy = false,
}: {
  name?: string | null;
  value?: string | null;
  onPick: (next: string | null) => void;
  busy?: boolean;
}) {
  const { theme, t } = useStore();
  const ui = theme.colors;
  const current = parseAvatar(value);
  const tone = current?.tone ?? DEFAULT_TONE;
  const hair = current?.hair ?? DEFAULT_HAIR;

  const person = (kind: AvatarKind | null) => {
    const selected = kind === (current?.kind ?? null);
    return (
      <TouchableOpacity
        key={kind || 'none'}
        // radio, not button: these are one-of-N choices, and a screen reader
        // should say "selected" for the one in force. It is also the only role
        // that carries the state — aria-selected is not valid on a button, so
        // React Native Web drops it and the choice becomes invisible to
        // assistive tech (and to a harness reading the same attribute).
        testID={`avatar-${kind || 'none'}`}
        accessibilityRole="radio"
        // Both spellings on purpose. accessibilityState is what native reads;
        // react-native-web 0.21 does NOT map its `checked` to aria-checked, so
        // on the web the state simply never reached the DOM and the choice was
        // invisible to a screen reader. The direct aria- prop is what does.
        accessibilityState={{ checked: selected }}
        aria-checked={selected}
        accessibilityLabel={t(kind ? `avatar_${kind}` : 'avatar_none')}
        disabled={busy}
        activeOpacity={0.8}
        onPress={() => onPick(kind ? avatarValue(kind, tone, hair) : null)}
        style={[
          pickerStyles.option,
          { borderColor: selected ? ui.accent : ui.cardBorder, opacity: busy ? 0.6 : 1 },
          selected ? pickerStyles.optionOn : null,
        ]}
      >
        {/* The picker draws its own ring, so the avatars inside go without —
            two concentric rings on a 46pt target reads as a target, not a face. */}
        <PersonAvatar
          name={name}
          avatar={kind ? avatarValue(kind, tone, hair) : null}
          size={52}
          ring={false}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={pickerStyles.wrap}>
      <View style={pickerStyles.row} accessibilityRole="radiogroup" accessibilityLabel={t('hub_picture')}>
        {AVATAR_KINDS.map((k) => person(k))}
        {person(null)}
      </View>

      {/* The tones only mean something once a drawing is chosen — offering
          them over a letter would be a control with nothing to change. */}
      {current ? (
        <View style={pickerStyles.row} accessibilityRole="radiogroup" accessibilityLabel={t('avatar_skin')}>
          <Text style={[pickerStyles.label, { color: ui.textMuted }]}>{t('avatar_skin')}</Text>
          {SKIN_TONES.map((hex, i) => (
            <TouchableOpacity
              key={hex}
              testID={`avatar-tone-${i}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: i === tone }}
              aria-checked={i === tone}
              accessibilityLabel={t('avatar_skin_n', { n: i + 1 })}
              disabled={busy}
              activeOpacity={0.8}
              onPress={() => onPick(avatarValue(current.kind, i, hair))}
              style={[
                pickerStyles.swatch,
                { backgroundColor: `#${hex}`, borderColor: i === tone ? ui.accent : ui.cardBorder },
                i === tone ? pickerStyles.optionOn : null,
              ]}
            />
          ))}
        </View>
      ) : null}

      {/* Hair colour, which is the half of this that was missing. Skin alone
          gave a household their own tone under somebody else's hair. Hidden
          for a drawing that has no hair to colour. */}
      {current && hasHairColour(current.kind) ? (
        <View style={pickerStyles.row} accessibilityRole="radiogroup" accessibilityLabel={t('avatar_hair')}>
          <Text style={[pickerStyles.label, { color: ui.textMuted }]}>{t('avatar_hair')}</Text>
          {HAIR_COLOURS.map((hex, i) => (
            <TouchableOpacity
              key={hex}
              testID={`avatar-hair-${i}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: i === hair }}
              aria-checked={i === hair}
              accessibilityLabel={t('avatar_hair_n', { n: i + 1 })}
              disabled={busy}
              activeOpacity={0.8}
              onPress={() => onPick(avatarValue(current.kind, tone, i))}
              style={[
                pickerStyles.swatch,
                { backgroundColor: `#${hex}`, borderColor: i === hair ? ui.accent : ui.cardBorder },
                i === hair ? pickerStyles.optionOn : null,
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: 'Inter_800ExtraBold' },
});

const pickerStyles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  // 58, not 46. Eight hair styles cannot be told apart in a 46pt circle —
  // Roland's screenshot of the picker was eight identical dark discs.
  option: { width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  optionOn: { borderWidth: 2.5 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, marginRight: 2 },
});
