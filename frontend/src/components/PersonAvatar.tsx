import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useStore } from '../store';

/**
 * The holder for a person's picture.
 *
 * Three things can sit in it, in order: one of four house illustrations, a
 * photo URL (Google sign-in already hands us one), or the initial. The
 * fallback matters — a household is half-set-up most of the time, and a
 * blank ring reads as a bug.
 *
 * Illustrations are drawn, not photographed, on purpose: nobody has to find a
 * picture of their eight-year-old to make the app look finished, and there is
 * no upload to store, moderate or delete.
 */
export const AVATAR_KINDS = ['man', 'woman', 'boy', 'girl'] as const;
export type AvatarKind = typeof AVATAR_KINDS[number];

/** Illustration values are stored as `illus:<kind>` so a photo URL still reads as a URL. */
export const ILLUS_PREFIX = 'illus:';

export function avatarKind(value?: string | null): AvatarKind | null {
  if (!value || !value.startsWith(ILLUS_PREFIX)) return null;
  const kind = value.slice(ILLUS_PREFIX.length) as AvatarKind;
  return (AVATAR_KINDS as readonly string[]).includes(kind) ? kind : null;
}

// Skin and hair stay neutral rather than trying to depict any one family —
// a silhouette that is clearly "a grown-up" or "a child" is what the header
// needs to say, and guessing further would get it wrong more often than right.
const PALETTE: Record<AvatarKind, { skin: string; hair: string; body: string }> = {
  man:   { skin: '#E8BE9A', hair: '#3B3230', body: '#2F5D57' },
  woman: { skin: '#EFC7A6', hair: '#4A2F26', body: '#B4553F' },
  boy:   { skin: '#E8BE9A', hair: '#5A4033', body: '#3F6E9E' },
  girl:  { skin: '#EFC7A6', hair: '#6B4327', body: '#8A5BA6' },
};

function Illustration({ kind, size }: { kind: AvatarKind; size: number }) {
  const p = PALETTE[kind];
  const child = kind === 'boy' || kind === 'girl';
  const long = kind === 'woman' || kind === 'girl';
  // Children get a bigger head on narrower shoulders — the one cue that still
  // reads at 30 points, where a hairstyle or a collar would not.
  const r = child ? 8.2 : 7.6;
  const cy = child ? 14.6 : 14.2;
  const brow = cy - 1.2;  // where the hair stops and the face starts
  const cap = r + 0.9;    // the hair overhangs the skull a little
  const shoulder = child
    ? 'M8.5 40c0-6.9 5.2-10.9 11.5-10.9S31.5 33.1 31.5 40z'
    : 'M5 40c0-8.1 6.7-12.3 15-12.3S35 31.9 35 40z';
  // Long hair is two rounded columns BEHIND the head, drawn before the face so
  // the face covers where they meet it. Short hair is a single half-disc cap
  // sitting on the brow. Both are flat shapes rather than crescents fitted to
  // the skull: the first version tried the crescent and drew a stray arc.
  const sidePanel = (x: number) => `M${x} ${brow} h3.6 v${r + 9.5} a1.8 1.8 0 0 1 -3.6 0 z`;
  const hairCap = `M${20 - cap} ${brow} a${cap} ${cap} 0 0 1 ${cap * 2} 0 z`;
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect width={40} height={40} fill="#ECEEEC" />
      {long ? (
        <>
          <Path d={sidePanel(20 - cap)} fill={p.hair} />
          <Path d={sidePanel(20 + cap - 3.6)} fill={p.hair} />
        </>
      ) : null}
      <Path d={`M17.4 ${cy + r - 2} h5.2 v6 h-5.2 z`} fill={p.skin} />
      <Path d={shoulder} fill={p.body} />
      <Circle cx={20} cy={cy} r={r} fill={p.skin} />
      <Path d={hairCap} fill={p.hair} />
    </Svg>
  );
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
  const kind = avatarKind(avatar);
  const isPhoto = !!avatar && !kind && /^https?:\/\//.test(avatar);
  const box = [
    styles.box,
    { width: size, height: size, borderRadius: size / 2, backgroundColor: ui.accentSoft },
    ring ? { borderWidth: 1.5, borderColor: ui.cardBorder } : null,
  ];

  if (kind) {
    return (
      <View style={box}>
        <Illustration kind={kind} size={size} />
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

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: 'Inter_800ExtraBold' },
});

/**
 * The four drawings, offered in a row, plus the letter you already had.
 *
 * Inline rather than behind a sheet: five choices do not earn a modal, and a
 * picture is the kind of thing you change by seeing the options next to the
 * thing they will replace.
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
  const current = avatarKind(value);

  const option = (kind: AvatarKind | null) => {
    const selected = kind === current;
    return (
      <TouchableOpacity
        key={kind || 'none'}
        testID={`avatar-${kind || 'none'}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t(kind ? `avatar_${kind}` : 'avatar_none')}
        disabled={busy}
        activeOpacity={0.8}
        onPress={() => onPick(kind ? `${ILLUS_PREFIX}${kind}` : null)}
        style={[
          pickerStyles.option,
          { borderColor: selected ? ui.accent : theme.colors.cardBorder, opacity: busy ? 0.6 : 1 },
          selected ? { borderWidth: 2.5 } : null,
        ]}
      >
        {/* The picker draws its own ring, so the avatars inside go without —
            two concentric rings on a 44pt target reads as a target, not a face. */}
        <PersonAvatar name={name} avatar={kind ? `${ILLUS_PREFIX}${kind}` : null} size={40} ring={false} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={pickerStyles.row}>
      {AVATAR_KINDS.map((k) => option(k))}
      {option(null)}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  option: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
