/**
 * What is waiting on the other side of an invitation.
 *
 * An invitation that shows only who sent it asks somebody to sign up for an
 * unknown. Showing the household they would be joining, and the one thing
 * already put aside for them, is the difference between an ask and an
 * introduction — and it is the rung of the activation ladder where 90 of 92
 * households stop.
 *
 * Counts, never titles. The reader has not joined and may never join, so they
 * are shown how big the thing is, not what is in it. The server enforces the
 * same rule; this is not the place it is decided.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HandoverCandidate, InvitedHousehold } from '../api';
import { glyphFor } from '../cardIcons';
import { useStore } from '../store';

type Props = {
  inviterName: string;
  handover?: HandoverCandidate | null;
  household?: InvitedHousehold | null;
  /**
   * After joining rather than before: the same card, now theirs. Everything
   * else is dropped, because at that point the household is no longer a thing
   * being described from outside — they are in it.
   */
  collected?: boolean;
};

export function InvitePreview({ inviterName, handover, household, collected }: Props) {
  const { t, theme } = useStore();
  const c = theme.colors;

  // Nothing to say is a real state: an invitation sent from an older build
  // carries no handover, and a household with nothing in it has no counts
  // worth showing. Rendering nothing beats rendering three zeros.
  const counts: { value: number; label: string }[] = [];
  if (household) {
    if (household.things_this_week > 0) {
      counts.push({ value: household.things_this_week, label: t('invite_preview_week') });
    }
    if (household.children > 0) {
      counts.push({ value: household.children, label: t('invite_preview_children') });
    }
    if (household.shopping_items > 0) {
      counts.push({ value: household.shopping_items, label: t('invite_preview_shopping') });
    }
  }
  if (!handover && counts.length === 0) return null;

  return (
    <View
      testID="invite-preview"
      style={[styles.wrap, { backgroundColor: c.card, borderColor: c.cardBorder }]}
    >
      {handover ? (
        <View style={styles.handoverBlock}>
          <Text style={[styles.eyebrow, { color: c.textMuted }]}>
            {collected ? t('invite_preview_now_yours') : t('invite_preview_waiting')}
          </Text>
          <View
            testID="invite-preview-handover"
            style={[styles.card, { backgroundColor: c.bgSoft, borderColor: c.accent }]}
          >
            <View style={[styles.iconTile, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
              <Text style={styles.glyph}>{glyphFor(handover.icon || '')}</Text>
            </View>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={2}>{handover.title}</Text>
              <Text style={[styles.cardNote, { color: c.accent }]} numberOfLines={1}>
                {(collected ? t('invite_preview_handed_done') : t('invite_preview_handed'))
                  .split('{name}').join(inviterName)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {!collected && counts.length > 0 ? (
        <View style={styles.counts} testID="invite-preview-counts">
          {counts.map((row) => (
            <View key={row.label} style={[styles.count, { backgroundColor: c.bgSoft }]}>
              <Text style={[styles.countValue, { color: c.text }]}>{row.value}</Text>
              <Text style={[styles.countLabel, { color: c.textMuted }]} numberOfLines={2}>{row.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 12, width: '100%' },
  handoverBlock: { gap: 7 },
  eyebrow: {
    fontFamily: 'Figtree_700Bold', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase',
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10,
  },
  iconTile: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  glyph: { fontSize: 17 },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontFamily: 'Figtree_700Bold', fontSize: 14, lineHeight: 19 },
  cardNote: { fontFamily: 'Figtree_600SemiBold', fontSize: 11.5, lineHeight: 15 },
  counts: { flexDirection: 'row', gap: 8 },
  count: { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 2 },
  countValue: { fontFamily: 'Figtree_800ExtraBold', fontSize: 19 },
  countLabel: { fontFamily: 'Figtree_600SemiBold', fontSize: 10.5, lineHeight: 13, textAlign: 'center' },
});
