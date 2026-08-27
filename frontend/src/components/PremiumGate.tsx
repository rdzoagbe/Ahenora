import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Lock, Sparkles } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { localeFor } from '../utils/date';

// Premium features gated behind paid plans (Executive+). Keep keys in sync with
// the backend PLAN_CATALOG limit flags and PREMIUM_FEATURE_MESSAGES.
export type PremiumFeature = 'meal_planner' | 'allowance' | 'carpool' | 'weekly_report' | 'gift_pot' | 'secret_santa';

/**
 * Hook for premium feature gating. `isLocked(feature)` tells you whether the
 * current plan blocks the feature; `promptUpgrade(feature)` opens the global
 * upgrade modal. Admin/unlocked accounts are never locked.
 * Prompt copy lives in i18n under `premium_<feature>` so it follows the
 * user's language.
 */
export function usePremiumGate() {
  const { subscription, showUpgradePrompt, t } = useStore();

  const isLocked = (feature: PremiumFeature): boolean => {
    if (!subscription) return false; // unknown yet — don't lock the UI prematurely
    if (subscription.admin_unlocked) return false;
    return subscription.limits?.[feature] === false;
  };

  const promptUpgrade = (feature: PremiumFeature) => {
    showUpgradePrompt(feature, t(`premium_${feature}`));
  };

  return { isLocked, promptUpgrade };
}

/** Small "Upgrade" lock pill shown next to a gated feature's header. */
export function LockBadge({ onPress }: { onPress: () => void }) {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);
  return (
    <PressScale onPress={onPress} style={styles.badge}>
      <Lock color={ui.orange} size={12} />
      <Text style={styles.badgeText}>{t('upg_badge')}</Text>
    </PressScale>
  );
}

/**
 * Testing-window notice shown on Premium features while everyone has them
 * free. Sets the expectation that these become part of Premium at launch, so
 * gating never feels like a surprise takeaway. Renders nothing once billing
 * is live (or for admin accounts). Tapping opens the pricing screen.
 */
export function PremiumPreviewBanner() {
  const ui = useUI();
  const { t, subscription, lang } = useStore();
  const router = useRouter();
  const styles = createStyles(ui);
  // Captured once at mount so the render stays pure; a days-left banner doesn't
  // need to tick down live within a single screen view.
  const [now] = useState(() => Date.now());
  if (!subscription?.testing_window || subscription?.admin_unlocked) return null;

  // Grace period: once a cutover date is announced, the notice becomes a
  // countdown ("Premium becomes paid on <date> — <n> days left"). Before a date
  // is set it stays the plain free-preview notice, so nothing counts down to a
  // date that doesn't exist yet.
  let title = t('preview_banner_title');
  let body = t('preview_banner_body');
  const startsAt = subscription?.billing_starts_at;
  if (startsAt) {
    const target = new Date(startsAt);
    const ms = target.getTime() - now;
    if (!Number.isNaN(target.getTime()) && ms > 0) {
      const days = Math.max(1, Math.ceil(ms / 86400000));
      const dateLabel = target.toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' });
      title = t('preview_countdown_title', { date: dateLabel });
      body = t('preview_countdown_body', { days });
    }
  }

  return (
    <PressScale onPress={() => router.push('/pricing')} style={styles.preview}>
      <Sparkles color={ui.orange} size={15} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.previewTitle}>{title}</Text>
        <Text style={styles.previewBody}>{body}</Text>
      </View>
      <Text style={styles.previewCta}>{t('preview_banner_cta')}</Text>
    </PressScale>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: ui.orange + '1A',
      borderWidth: 1,
      borderColor: ui.orange + '40',
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: ui.orangeText,
    },
    preview: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: ui.orange + '14',
      borderWidth: 1,
      borderColor: ui.orange + '33',
      marginBottom: 12,
    },
    previewTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 13 },
    previewBody: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 1 },
    previewCta: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  });
