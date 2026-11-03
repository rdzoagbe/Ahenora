import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Star, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

/**
 * What the children finished and is waiting for a grown-up, on Home.
 *
 * A child's ticked job or task pays nothing until a parent approves it
 * (kid mode, 2026-11-03). The queue lived only on the Family tab and in a
 * notification, so a parent who missed the notification left the child
 * waiting for their stars. Roland chose to bring it to Home: each row says
 * what and who, and the stars are chosen right there in one tap (+1, +3, +5),
 * the same choices as the Family tab, without a pop-up. Dismiss says it was
 * not done; it pays nothing.
 */
export type ApprovalRow = { card_id: string; title: string; who?: string; teen_name?: string };

export const HOME_APPROVALS_SHOWN = 3;
export const STAR_CHOICES = [1, 3, 5] as const;

export function HomeApprovals({
  rows,
  busyId,
  onApprove,
  onDismiss,
  onMore,
}: {
  rows: ApprovalRow[];
  busyId: string | null;
  onApprove: (id: string, stars: number) => void;
  onDismiss: (id: string) => void;
  onMore: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, HOME_APPROVALS_SHOWN);
  const more = rows.length - shown.length;
  return (
    <View style={styles.card} testID="home-approvals">
      <Text style={styles.title}>{t('home_approvals_title')}</Text>
      <Text style={styles.sub}>{t('teen_approvals_sub')}</Text>
      {shown.map((r) => {
        const busy = busyId === r.card_id;
        const who = (r.who || r.teen_name || '').trim();
        return (
          <View key={r.card_id} style={styles.row} testID={`home-approval-${r.card_id}`}>
            <View style={styles.rowTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.what} numberOfLines={2}>{r.title}</Text>
                {who ? <Text style={styles.who} numberOfLines={1}>{who}</Text> : null}
              </View>
              <PressScale
                testID={`home-approval-dismiss-${r.card_id}`}
                accessibilityRole="button"
                accessibilityLabel={`${t('teen_dismiss')}, ${r.title}`}
                disabled={busy}
                onPress={() => onDismiss(r.card_id)}
                style={[styles.dismiss, busy && styles.busy]}
              >
                <X color={ui.muted} size={18} />
              </PressScale>
            </View>
            <View style={styles.chips}>
              {STAR_CHOICES.map((n) => (
                <PressScale
                  key={n}
                  testID={`home-approval-${n}-${r.card_id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('home_approve_n', { n })}, ${r.title}`}
                  disabled={busy}
                  onPress={() => onApprove(r.card_id, n)}
                  style={[styles.chip, n === 3 && styles.chipMain, busy && styles.busy]}
                >
                  <Text style={[styles.chipText, n === 3 && styles.chipTextMain]}>+{n}</Text>
                  <Star color={n === 3 ? '#FFFFFF' : ui.goldText} fill={n === 3 ? '#FFFFFF' : ui.goldText} size={14} strokeWidth={1.6} />
                </PressScale>
              ))}
            </View>
          </View>
        );
      })}
      {more > 0 ? (
        <PressScale testID="home-approvals-more" accessibilityRole="link" onPress={onMore} style={styles.more}>
          <Text style={styles.moreText}>{t('home_approvals_more', { n: more })}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

function createStyles(ui: UIColors) {
  return StyleSheet.create({
    card: { marginTop: 14, backgroundColor: ui.gold, borderRadius: 24, padding: 16, gap: 10 },
    title: { fontFamily: 'Figtree_800ExtraBold', fontSize: 17, color: ui.text },
    sub: { fontFamily: 'Figtree_600SemiBold', fontSize: 13, color: ui.goldText, marginTop: -6 },
    row: { backgroundColor: ui.card, borderRadius: 18, padding: 12, gap: 10 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    what: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.text },
    who: { fontFamily: 'Figtree_600SemiBold', fontSize: 13, color: ui.muted, marginTop: 2 },
    dismiss: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.soft },
    chips: { flexDirection: 'row', gap: 8 },
    chip: {
      flex: 1, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: ui.line, backgroundColor: ui.card,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    },
    chipMain: { backgroundColor: ui.orange, borderColor: ui.orange },
    chipText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.text },
    chipTextMain: { color: '#FFFFFF' },
    busy: { opacity: 0.5 },
    more: { alignSelf: 'flex-start', paddingVertical: 4 },
    moreText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 14, color: ui.orangeText },
  });
}
