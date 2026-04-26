import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Sparkles, X, ArrowRight } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

export function UpgradeModal() {
  const { upgradePrompt, dismissUpgradePrompt, t } = useStore();
  const router = useRouter();
  const visible = !!upgradePrompt;

  const goToPricing = () => {
    dismissUpgradePrompt();
    router.push('/pricing');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissUpgradePrompt}>
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.badge}>
              <Sparkles color="#fff" size={12} />
              <Text style={styles.badgeText}>{t('upgrade_needed')}</Text>
            </View>
            <PressScale testID="upgrade-close" onPress={dismissUpgradePrompt} style={styles.closeBtn}>
              <X color="#fff" size={18} />
            </PressScale>
          </View>
          <Text style={styles.title}>{upgradePrompt?.message || 'Unlock more with an upgrade.'}</Text>
          <View style={styles.actions}>
            <PressScale
              testID="upgrade-dismiss"
              onPress={dismissUpgradePrompt}
              style={styles.dismissBtn}
            >
              <Text style={styles.dismissText}>{t('dismiss')}</Text>
            </PressScale>
            <PressScale testID="upgrade-cta" onPress={goToPricing} style={styles.ctaBtn}>
              <Text style={styles.ctaText}>{t('upgrade_cta')}</Text>
              <ArrowRight color="#080910" size={14} />
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.6)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(20,22,32,0.98)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 22,
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
    backgroundColor: 'rgba(52,211,153,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
    borderRadius: 9999,
  },
  badgeText: { color: '#34D399', fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.4 },
  closeBtn: {
    padding: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff',
    fontSize: 22,
    lineHeight: 28,
    marginTop: 14,
    marginBottom: 22,
  },
  actions: { flexDirection: 'row', gap: 10 },
  dismissBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Inter_500Medium', fontSize: 13 },
  ctaBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 9999,
    backgroundColor: '#fff',
  },
  ctaText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});
