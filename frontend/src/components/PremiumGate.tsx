import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

// Premium features gated behind paid plans (Executive+). Keep keys in sync with
// the backend PLAN_CATALOG limit flags and PREMIUM_FEATURE_MESSAGES.
export type PremiumFeature = 'meal_planner' | 'allowance' | 'carpool' | 'weekly_report';

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
      color: ui.orange,
    },
  });
