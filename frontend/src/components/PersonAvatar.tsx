import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useStore } from '../store';
import { FACES, faceFor, faceGroupOrder, faceValue, type FaceGroup } from '../faces';
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
  const face = faceFor(avatar);
  const illus = face ? null : parseAvatar(avatar);
  const isPhoto = !!avatar && !face && !illus && /^https?:\/\//.test(avatar);
  const box = [
    styles.box,
    { width: size, height: size, borderRadius: size / 2, backgroundColor: ui.accentSoft },
    ring ? { borderWidth: 1.5, borderColor: ui.cardBorder } : null,
  ];

  if (face) {
    return (
      // One of the 3D faces (src/faces.ts). Each file is a face on its own
      // cream disc, so it is drawn edge to edge and the round box clips it.
      <View style={[box, { backgroundColor: ILLUSTRATION_GROUND }]}>
        <Image source={face.src} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
      </View>
    );
  }
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
 * The faces, grouped.
 *
 * Roland, 2026-11-03/04: the drawn heads did not look good beside the app's
 * paintings; the 3D faces he made in Gemini did (src/faces.ts). Everyone picks
 * one, or keeps their initial. A child's page shows the children's faces
 * first, everyone else's the grown-ups'. A drawing chosen before this still
 * shows on its owner until they pick a face; it is simply no longer offered.
 */
export function AvatarPicker({
  name,
  value,
  onPick,
  busy = false,
  forChild = false,
}: {
  name?: string | null;
  value?: string | null;
  onPick: (next: string | null) => void;
  busy?: boolean;
  /** A child's page: their faces come first. */
  forChild?: boolean;
}) {
  const { theme, t } = useStore();
  const ui = theme.colors;
  const current = faceFor(value)?.id ?? null;
  const hasNothing = !value;

  const option = (id: string | null, label: string) => {
    const selected = id ? id === current : hasNothing;
    return (
      <TouchableOpacity
        key={id || 'none'}
        // radio, not button: one of N, and the role that carries the state.
        // Both spellings of checked on purpose: react-native-web does not map
        // accessibilityState.checked to aria-checked.
        testID={`avatar-${id ? `face-${id}` : 'none'}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        aria-checked={selected}
        accessibilityLabel={label}
        disabled={busy}
        activeOpacity={0.8}
        onPress={() => onPick(id ? faceValue(id) : null)}
        style={[
          pickerStyles.option,
          { borderColor: selected ? ui.accent : ui.cardBorder, opacity: busy ? 0.6 : 1 },
          selected ? pickerStyles.optionOn : null,
        ]}
      >
        {/* The picker draws its own ring, so the face inside goes without. */}
        <PersonAvatar name={name} avatar={id ? faceValue(id) : null} size={60} ring={false} />
      </TouchableOpacity>
    );
  };

  const groupLabel = (g: FaceGroup) => t(`avatar_group_${g}`);

  return (
    <View style={pickerStyles.wrap}>
      {faceGroupOrder(forChild).map((g) => {
        const faces = FACES.filter((f) => f.group === g);
        return (
          <View key={g} style={pickerStyles.group}>
            <Text style={[pickerStyles.label, { color: ui.textMuted }]}>{groupLabel(g)}</Text>
            <View style={pickerStyles.row} accessibilityRole="radiogroup" accessibilityLabel={groupLabel(g)}>
              {faces.map((f, i) => option(f.id, t('avatar_face_n', { group: groupLabel(g), n: i + 1 })))}
            </View>
          </View>
        );
      })}
      <View style={pickerStyles.group}>
        <Text style={[pickerStyles.label, { color: ui.textMuted }]}>{t('avatar_none')}</Text>
        <View style={pickerStyles.row}>{option(null, t('avatar_none'))}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: 'Figtree_800ExtraBold' },
});

const pickerStyles = StyleSheet.create({
  wrap: { gap: 14 },
  group: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  // 64: a face has to be recognisable at a glance, not squinted at.
  option: { width: 64, height: 64, borderRadius: 32, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  optionOn: { borderWidth: 3 },
  label: { fontFamily: 'Figtree_700Bold', fontSize: 13 },
});
