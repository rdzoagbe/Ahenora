import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

// Premium features gated behind paid plans (Executive+). Keep keys in sync with
// the backend PLAN_CATALOG limit flags and PREMIUM_FEATURE_MESSAGES.
export type PremiumFeature = 'meal_planner' | 'allowance' | 'carpool' | 'weekly_report';

const MESSAGES: Record<PremiumFeature, string> = {
  meal_planner: 'Meal Planner is available on Executive and Family Office plans.',
  allowance: 'Allowance Tracker is available on Executive and Family Office plans.',
  carpool: 'Carpool Coordinator is available on Executive and Family Office plans.',
  weekly_report: 'Weekly Report is available on Executive and Family Office plans.',
};

/**
 * Hook for premium feature gating. `isLocked(feature)` tells you whether the
 * current plan blocks the feature; `promptUpgrade(feature)` opens the global
 * upgrade modal. Admin/unlocked accounts are never locked.
 */
export function usePremiumGate() {
  const { subscription, showUpgradePrompt } = useStore();

  const isLocked = (feature: PremiumFeature): boolean => {
    if (!subscription) return false; // unknown yet — don't lock the UI prematurely
    if (subscription.admin_unlocked) return false;
    return subscription.limits?.[feature] === false;
  };

  const promptUpgrade = (feature: PremiumFeature) => {
    showUpgradePrompt(feature, MESSAGES[feature]);
  };

  return { isLocked, promptUpgrade };
}

/** Small "Upgrade" lock pill shown next to a gated feature's header. */
export function LockBadge({ onPress }: { onPress: () => void }) {
  const ui = useUI();
  const styles = createStyles(ui);
  return (
    <PressScale onPress={onPress} style={styles.badge}>
      <Lock color={ui.orange} size={12} />
      <Text style={styles.badgeText}>Upgrade</Text>
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
