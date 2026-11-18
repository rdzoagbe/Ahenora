/**
 * The household's faces, overlapping like a group photo.
 *
 * Over the Family tab's title (Roland chose his family's own faces there on
 * 2026-11-18, where the star-chart painting was: the chart is about rewards,
 * and that half of the tab still has it), and beside the "Whose turn?"
 * introduction, where it shows who would be taking turns.
 *
 * One picture to a screen reader: the names, read once.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { FamilyMember } from '../api';
import { useUI } from './Kit';
import { PersonAvatar } from './PersonAvatar';

type Props = {
  people: FamilyMember[];
  /** How many more there are than the faces drawn: shown as "+2". */
  more?: number;
  size?: number;
  /** The colour between the faces: the ground they sit on. */
  ground: string;
  /** Faces rise and fall a little, as people do in a photograph. */
  staggered?: boolean;
  label: string;
  testID?: string;
};

export default function FamilyFaces({ people, more = 0, size = 44, ground, staggered = false, label, testID }: Props) {
  const ui = useUI();
  if (people.length === 0) return null;
  const overlap = Math.round(size * 0.3);
  const lift = staggered ? Math.round(size * 0.22) : 0;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.row, { height: size + 6 + lift }]}
    >
      {people.map((m, i) => (
        <View
          key={m.member_id}
          style={[
            styles.face,
            { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, borderColor: ground, backgroundColor: ground },
            i > 0 && { marginLeft: -overlap },
            staggered && { marginTop: i % 2 === 0 ? lift : 0 },
          ]}
        >
          <PersonAvatar name={m.name} avatar={m.avatar} size={size} ring={false} />
        </View>
      ))}
      {more > 0 ? (
        <View
          style={[
            styles.face, styles.more,
            { width: size * 0.7 + 6, height: size * 0.7 + 6, borderRadius: size, borderColor: ground, backgroundColor: ui.soft, marginLeft: -overlap },
            staggered && { marginTop: lift + size * 0.3 },
          ]}
        >
          <Text style={[styles.moreText, { color: ui.text }]}>+{more}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  face: { borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  more: {},
  moreText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 12 },
});
