import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
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
  // Children get a bigger head on a smaller body — the one cue that reads at
  // 30px, where hairstyles and clothing do not.
  const headR = child ? 9 : 7.5;
  const headY = child ? 15.5 : 15;
  const shoulder = child ? 'M8 40c0-7 5.4-10.5 12-10.5S32 33 32 40z' : 'M6 40c0-8 6.3-12 14-12s14 4 14 12z';
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect width={40} height={40} fill="#ECEEEC" />
      <Path d={shoulder} fill={p.body} />
      <Circle cx={20} cy={headY} r={headR} fill={p.skin} />
      {kind === 'woman' || kind === 'girl' ? (
        // Longer hair falls past the jaw; drawn behind nothing, so it reads
        // even when the whole thing is 30 points wide.
        <Path
          d={`M${20 - headR - 1.5} ${headY + 5}c-.6-4 .4-7 .8-9.5C21 ${headY - headR - 3} 27 ${headY - headR + 1} ${20 + headR + 0.7} ${headY + 5}c-.5-3-1.6-5.4-3.4-6.6-2.7 1.8-6.1 1.8-8.8 0-1.8 1.2-2.9 3.6-3.4 6.6z`}
          fill={p.hair}
        />
      ) : (
        <Path d={`M${20 - headR} ${headY - 2.5}a${headR} ${headR} 0 0 1 ${headR * 2} 0c0-5-3-7-${headR} -7s-${headR} 2-${headR} 7z`} fill={p.hair} />
      )}
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
      <Text style={[styles.initial, { color: ui.accentInk, fontSize: Math.round(size * 0.42) }]}>
        {(name || '?').trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontFamily: 'Inter_800ExtraBold' },
});
