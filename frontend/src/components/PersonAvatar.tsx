import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useStore } from '../store';
import { AVATAR_ART, SKIN_TOKEN } from '../avatarArt';

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
export const AVATAR_KINDS = ['man', 'woman', 'boy', 'girl'] as const;
export type AvatarKind = typeof AVATAR_KINDS[number];

/**
 * Five tones rather than the two that were asked for. It costs one hex each —
 * the drawing is identical and the tone is a string replace — and two tones
 * makes a household pick the nearer of two, which is worse than not offering
 * the choice at all.
 */
export const SKIN_TONES = ['ffdbb4', 'edb98a', 'd08b5b', 'ae5d29', '614335'] as const;
export const DEFAULT_TONE = 1;

/** Stored as `illus:<kind>` or `illus:<kind>:<tone>`, so a photo URL still reads as a URL. */
export const ILLUS_PREFIX = 'illus:';

export function avatarValue(kind: AvatarKind, tone: number): string {
  return `${ILLUS_PREFIX}${kind}:${tone}`;
}

/** Parses a stored value. Tone is optional: rows written before tones existed
 *  carry only a kind, and must keep rendering rather than fall back to a letter. */
export function parseAvatar(value?: string | null): { kind: AvatarKind; tone: number } | null {
  if (!value || !value.startsWith(ILLUS_PREFIX)) return null;
  const [kind, rawTone] = value.slice(ILLUS_PREFIX.length).split(':');
  if (!(AVATAR_KINDS as readonly string[]).includes(kind)) return null;
  const tone = Number(rawTone);
  return {
    kind: kind as AvatarKind,
    tone: Number.isInteger(tone) && tone >= 0 && tone < SKIN_TONES.length ? tone : DEFAULT_TONE,
  };
}

/** Back-compat name for callers that only need to know an illustration is set. */
export function avatarKind(value?: string | null): AvatarKind | null {
  return parseAvatar(value)?.kind ?? null;
}

function Illustration({ kind, tone, size }: { kind: AvatarKind; tone: number; size: number }) {
  const art = AVATAR_ART[kind];
  if (!art) return null;
  // The whole reason the art carries a token instead of a colour: one drawing
  // serves every tone, so five tones cost five hex values rather than five
  // copies of the same 5KB picture.
  const xml = art.split(SKIN_TOKEN).join(`#${SKIN_TONES[tone]}`);
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
      <View style={box}>
        <Illustration kind={illus.kind} tone={illus.tone} size={size} />
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

  const person = (kind: AvatarKind | null) => {
    const selected = kind === (current?.kind ?? null);
    return (
      <TouchableOpacity
        key={kind || 'none'}
        testID={`avatar-${kind || 'none'}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={t(kind ? `avatar_${kind}` : 'avatar_none')}
        disabled={busy}
        activeOpacity={0.8}
        onPress={() => onPick(kind ? avatarValue(kind, tone) : null)}
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
          avatar={kind ? avatarValue(kind, tone) : null}
          size={40}
          ring={false}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={pickerStyles.wrap}>
      <View style={pickerStyles.row}>
        {AVATAR_KINDS.map((k) => person(k))}
        {person(null)}
      </View>

      {/* The tones only mean something once a drawing is chosen — offering
          them over a letter would be a control with nothing to change. */}
      {current ? (
        <View style={pickerStyles.row}>
          <Text style={[pickerStyles.label, { color: ui.textMuted }]}>{t('avatar_skin')}</Text>
          {SKIN_TONES.map((hex, i) => (
            <TouchableOpacity
              key={hex}
              testID={`avatar-tone-${i}`}
              accessibilityRole="button"
              accessibilityState={{ selected: i === tone }}
              accessibilityLabel={t('avatar_skin_n', { n: i + 1 })}
              disabled={busy}
              activeOpacity={0.8}
              onPress={() => onPick(avatarValue(current.kind, i))}
              style={[
                pickerStyles.swatch,
                { backgroundColor: `#${hex}`, borderColor: i === tone ? ui.accent : ui.cardBorder },
                i === tone ? pickerStyles.optionOn : null,
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
  option: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  optionOn: { borderWidth: 2.5 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, marginRight: 2 },
});
