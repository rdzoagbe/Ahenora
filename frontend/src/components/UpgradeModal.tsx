import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Sparkles, X, ArrowRight } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

export function UpgradeModal() {
  const { upgradePrompt, dismissUpgradePrompt, t, theme } = useStore();
  const router = useRouter();
  const visible = !!upgradePrompt;

  const goToPricing = () => {
    dismissUpgradePrompt();
    router.push('/pricing');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissUpgradePrompt}>
      <BlurView intensity={40} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      <View style={[styles.backdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.52)' : 'rgba(8,9,16,0.6)' }]} />
      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}> 
          <View style={styles.headerRow}>
            <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}> 
              <Sparkles color={theme.colors.accent} size={12} />
              <Text style={[styles.badgeText, { color: theme.colors.accent }]}>{t('upgrade_needed')}</Text>
            </View>
            <PressScale testID="upgrade-close" onPress={dismissUpgradePrompt} style={[styles.closeBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}> 
              <X color={theme.colors.text} size={18} />
            </PressScale>
          </View>
          <Text style={[styles.title, { color: theme.colors.text }]}>{upgradePrompt?.message || 'Unlock more with an upgrade.'}</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Paid upgrades are parked for testing and will use the approved Google Play billing flow later.</Text>
          <View style={styles.actions}>
            <PressScale
              testID="upgrade-dismiss"
              onPress={dismissUpgradePrompt}
              style={[styles.dismissBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
            >
              <Text style={[styles.dismissText, { color: theme.colors.text }]}>{t('dismiss')}</Text>
            </PressScale>
            <PressScale testID="upgrade-cta" onPress={goToPricing} style={[styles.ctaBtn, { backgroundColor: theme.colors.primary }]}> 
              <Text style={[styles.ctaText, { color: theme.colors.primaryText }]}>{t('upgrade_cta')}</Text>
              <ArrowRight color={theme.colors.primaryText} size={14} />
            </PressScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Helper — call this from any try/catch when an API 402 plan limit is caught
export function handlePlanLimitError(err: any, showUpgradePrompt: (f: string, m: string) => void): boolean {
  if (err?.status === 402 && err?.planLimit) {
    showUpgradePrompt(err.planLimit.feature, err.planLimit.message || 'Upgrade to continue.');
    return true;
  }
  return false;
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 9999,
  },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.4 },
  closeBtn: {
    padding: 8,
    borderRadius: 9999,
    borderWidth: 1,
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 23,
    lineHeight: 30,
    marginTop: 14,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 22,
  },
  actions: { flexDirection: 'row', gap: 10 },
  dismissBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 9999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  ctaBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 9999,
  },
  ctaText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
});
