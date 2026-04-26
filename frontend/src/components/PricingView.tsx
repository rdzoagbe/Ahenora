import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeInDown,
  FadeIn,
  Layout,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import {
  Sparkles,
  Star,
  Users,
  Shield,
  Check,
  Crown,
  Zap,
  Briefcase,
  Gem,
  ArrowRight,
} from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, Plan, BillingCycle, Subscription } from '../api';

const PLAN_ORDER: Plan[] = ['village', 'executive', 'family_office'];

// Plan prices in USD. Yearly = ~20% off monthly × 12
const PLAN_PRICES: Record<Plan, { monthly: number; yearly: number }> = {
  village: { monthly: 0, yearly: 0 },
  executive: { monthly: 14.99, yearly: 143.99 }, // ~ $12/mo billed yearly
  family_office: { monthly: 49.99, yearly: 479.99 }, // ~ $40/mo billed yearly
};

interface Props {
  // When embedded in Settings, we have a subscription; on public landing, no subscription.
  embedded?: boolean;
  onAuthRequired?: () => void;
  onClose?: () => void;
}

export function PricingView({ embedded = false, onAuthRequired, onClose }: Props) {
  const { t, subscription, user, refreshSubscription } = useStore();
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const toggleAnim = useSharedValue(1); // 0=monthly, 1=yearly

  useEffect(() => {
    toggleAnim.value = withSpring(cycle === 'yearly' ? 1 : 0, {
      damping: 16,
      stiffness: 180,
    });
  }, [cycle]);

  const currentPlan: Plan = subscription?.plan ?? 'village';

  const handleChoose = async (plan: Plan) => {
    if (!user) {
      // public landing: redirect to sign-in
      onAuthRequired?.();
      return;
    }
    if (plan === currentPlan && subscription?.billing_cycle === cycle) return;

    const doChange = async () => {
      setLoadingPlan(plan);
      try {
        await api.changeSubscription(plan, cycle);
        await refreshSubscription();
        if (Platform.OS === 'web') {
          // simple feedback
          setTimeout(() => {}, 0);
        } else {
          Alert.alert(t('confirmed_switched'));
        }
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Could not switch plan.');
      } finally {
        setLoadingPlan(null);
      }
    };

    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined'
        ? window.confirm(
            t('confirm_plan_change', { plan: t(`plan_${plan}`) }) +
              '\n\n' +
              t('confirm_plan_change_sub')
          )
        : true;
      if (ok) await doChange();
    } else {
      Alert.alert(
        t('confirm_plan_change', { plan: t(`plan_${plan}`) }),
        t('confirm_plan_change_sub'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('pricing_choose_plan'), onPress: doChange },
        ]
      );
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, embedded && { paddingTop: 0 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.duration(500)} style={styles.header}>
          <View style={styles.badge}>
            <Sparkles color="#fff" size={12} />
            <Text style={styles.badgeText}>{t('pricing_link')}</Text>
          </View>
          <Text style={styles.title}>{t('pricing_title')}</Text>
          <Text style={styles.subtitle}>{t('pricing_subtitle')}</Text>
        </Animated.View>

        {/* Billing Toggle */}
        <Animated.View entering={FadeInDown.duration(500).delay(120)}>
          <BillingToggle value={cycle} onChange={setCycle} t={t} animValue={toggleAnim} />
          {embedded ? (
            <Text style={styles.billingNote}>
              Testing mode: plan changes update Household COO access immediately. Stripe checkout can be connected next.
            </Text>
          ) : null}
        </Animated.View>

        {/* Plan Cards */}
        <View style={styles.cardsContainer}>
          {PLAN_ORDER.map((plan, idx) => (
            <Animated.View
              key={plan}
              entering={FadeInDown.duration(500).delay(200 + idx * 100)}
              layout={Layout.duration(300)}
            >
              <PlanCard
                plan={plan}
                cycle={cycle}
                isCurrent={plan === currentPlan}
                loading={loadingPlan === plan}
                onChoose={() => handleChoose(plan)}
                showCurrentBadge={embedded && plan === currentPlan}
                t={t}
              />
            </Animated.View>
          ))}
        </View>

        {/* FAQ */}
        <Animated.View
          entering={FadeInDown.duration(500).delay(600)}
          style={styles.faqWrap}
        >
          <Text style={styles.faqTitle}>{t('pricing_faq_title')}</Text>
          {[
            [t('pricing_faq_1_q'), t('pricing_faq_1_a')],
            [t('pricing_faq_2_q'), t('pricing_faq_2_a')],
            [t('pricing_faq_3_q'), t('pricing_faq_3_a')],
          ].map(([q, a], i) => (
            <View key={i} style={styles.faqItem}>
              <Text style={styles.faqQ}>{q}</Text>
              <Text style={styles.faqA}>{a}</Text>
            </View>
          ))}
        </Animated.View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Billing Toggle
// ─────────────────────────────────────────────────────────────
function BillingToggle({
  value,
  onChange,
  t,
  animValue,
}: {
  value: BillingCycle;
  onChange: (v: BillingCycle) => void;
  t: (k: string, p?: any) => string;
  animValue: Animated.SharedValue<number>;
}) {
  const pillStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: withTiming(animValue.value * 100, { duration: 240 }),
      },
    ],
  }));

  return (
    <View style={styles.toggleContainer}>
      <View style={styles.toggleTrack}>
        <Animated.View style={[styles.togglePill, pillStyle]} />
        <PressScale
          testID="toggle-monthly"
          onPress={() => onChange('monthly')}
          style={styles.toggleOption}
        >
          <Text style={[styles.toggleText, value === 'monthly' && styles.toggleTextActive]}>
            {t('pricing_monthly')}
          </Text>
        </PressScale>
        <PressScale
          testID="toggle-yearly"
          onPress={() => onChange('yearly')}
          style={styles.toggleOption}
        >
          <Text style={[styles.toggleText, value === 'yearly' && styles.toggleTextActive]}>
            {t('pricing_yearly')}
          </Text>
        </PressScale>
      </View>
      {value === 'yearly' ? (
        <Animated.View entering={FadeIn.duration(300)} style={styles.savingsBadge}>
          <Text style={styles.savingsText}>{t('pricing_save_20')}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Plan Card
// ─────────────────────────────────────────────────────────────
function PlanCard({
  plan,
  cycle,
  isCurrent,
  loading,
  onChoose,
  showCurrentBadge,
  t,
}: {
  plan: Plan;
  cycle: BillingCycle;
  isCurrent: boolean;
  loading: boolean;
  onChoose: () => void;
  showCurrentBadge: boolean;
  t: (k: string, p?: any) => string;
}) {
  const price = PLAN_PRICES[plan][cycle];
  const perMonth = cycle === 'yearly' ? price / 12 : price;
  const priceDisplay = cycle === 'yearly' ? perMonth : price;
  const isFree = plan === 'village';
  const isMiddle = plan === 'executive';

  // Icon + color per plan
  const theme = PLAN_THEMES[plan];
  const Icon = theme.icon;

  return (
    <View
      style={[
        styles.card,
        isMiddle && styles.cardFeatured,
      ]}
    >
      {/* Gradient backdrop */}
      <LinearGradient
        colors={theme.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {Platform.OS !== 'web' && (
        <BlurView intensity={8} tint="dark" style={StyleSheet.absoluteFill} />
      )}

      {isMiddle ? (
        <View style={styles.popularBadge}>
          <Crown color="#080910" size={10} />
          <Text style={styles.popularText}>{t('pricing_most_popular')}</Text>
        </View>
      ) : null}

      <View style={styles.cardHeader}>
        <View style={[styles.iconBubble, { backgroundColor: theme.iconBg }]}>
          <Icon color={theme.iconColor} size={18} />
        </View>
        <View style={styles.planNameRow}>
          <Text style={styles.planName}>{t(`plan_${plan}`)}</Text>
          <Text style={styles.planTag}>{t(`plan_${plan}_tag`)}</Text>
        </View>
      </View>

      <Text style={styles.planDesc}>{t(`plan_${plan}_desc`)}</Text>

      {/* Price with animated key */}
      <Animated.View
        key={`${plan}-${cycle}`}
        entering={FadeIn.duration(280)}
        style={styles.priceRow}
      >
        {isFree ? (
          <Text style={styles.freeText}>Free</Text>
        ) : (
          <>
            <Text style={styles.priceSymbol}>$</Text>
            <Text style={styles.priceValue}>
              {priceDisplay.toFixed(priceDisplay % 1 === 0 ? 0 : 2)}
            </Text>
            <Text style={styles.pricePer}>{t('pricing_per_month')}</Text>
          </>
        )}
      </Animated.View>
      {!isFree && cycle === 'yearly' ? (
        <Text style={styles.yearlyNote}>
          ${price.toFixed(2)} {t('pricing_billed_yearly')}
        </Text>
      ) : null}

      {/* Features */}
      <View style={styles.featuresList}>
        {theme.features.map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <View style={styles.featureCheck}>
              <Check color={theme.iconColor} size={12} />
            </View>
            <Text style={styles.featureText}>{t(f)}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      {showCurrentBadge && isCurrent ? (
        <View style={[styles.cta, styles.ctaCurrent]}>
          <Text style={[styles.ctaText, { color: '#fff' }]}>
            ✓ {t('pricing_current_plan')}
          </Text>
        </View>
      ) : (
        <PressScale
          testID={`pricing-choose-${plan}`}
          onPress={onChoose}
          style={[
            styles.cta,
            isMiddle ? styles.ctaPrimary : styles.ctaSecondary,
          ]}
        >
          {loading ? (
            <ActivityIndicator color={isMiddle ? '#080910' : '#fff'} size="small" />
          ) : (
            <>
              <Text style={[styles.ctaText, { color: isMiddle ? '#080910' : '#fff' }]}>
                {isFree ? t('pricing_get_started') : t('pricing_choose_plan')}
              </Text>
              <ArrowRight color={isMiddle ? '#080910' : '#fff'} size={14} />
            </>
          )}
        </PressScale>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Plan themes (colors + icons + features)
// ─────────────────────────────────────────────────────────────
const PLAN_THEMES: Record<
  Plan,
  {
    icon: any;
    iconBg: string;
    iconColor: string;
    gradient: readonly [string, string, ...string[]];
    features: string[];
  }
> = {
  village: {
    icon: Users,
    iconBg: 'rgba(99,102,241,0.15)',
    iconColor: '#A5B4FC',
    gradient: ['rgba(30,32,48,0.95)', 'rgba(20,22,34,0.98)'] as const,
    features: [
      'feat_members_3',
      'feat_ai_scans_10',
      'feat_vault_1gb',
      'feat_smart_feed',
      'feat_kid_mode',
    ],
  },
  executive: {
    icon: Briefcase,
    iconBg: 'rgba(16,185,129,0.18)',
    iconColor: '#34D399',
    gradient: ['rgba(16,185,129,0.15)', 'rgba(99,102,241,0.15)'] as const,
    features: [
      'feat_members_10',
      'feat_ai_scans_unlimited',
      'feat_vault_20gb',
      'feat_sunday_brief',
      'feat_voice_capture',
      'feat_email_invites',
      'feat_recurring',
    ],
  },
  family_office: {
    icon: Gem,
    iconBg: 'rgba(236,72,153,0.18)',
    iconColor: '#F472B6',
    gradient: ['rgba(236,72,153,0.12)', 'rgba(139,92,246,0.12)'] as const,
    features: [
      'feat_members_25',
      'feat_vault_100gb',
      'feat_multi_property',
      'feat_advanced_legal',
      'feat_priority_ai',
      'feat_concierge',
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },

  header: { alignItems: 'flex-start', marginBottom: 20 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
    marginBottom: 16,
  },
  badgeText: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff',
    fontSize: 34,
    lineHeight: 40,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    marginTop: 6,
  },

  // Toggle
  toggleContainer: {
    alignItems: 'center',
    marginVertical: 22,
    position: 'relative',
  },
  toggleTrack: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 9999,
    padding: 4,
    position: 'relative',
    width: 208,
  },
  togglePill: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 100,
    height: 34,
    borderRadius: 9999,
    backgroundColor: '#fff',
  },
  toggleOption: {
    width: 100,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  toggleText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  toggleTextActive: { color: '#080910' },
  savingsBadge: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: 'rgba(52,211,153,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
  },
  billingNote: {
    color: 'rgba(255,255,255,0.54)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  savingsText: {
    color: '#34D399',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.6,
  },

  // Cards
  cardsContainer: { gap: 14 },
  card: {
    position: 'relative',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 22,
    overflow: 'hidden',
  },
  cardFeatured: {
    borderColor: 'rgba(52,211,153,0.4)',
    shadowColor: '#34D399',
    shadowOpacity: 0.25,
    shadowRadius: 30,
  },

  popularBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9999,
    backgroundColor: '#34D399',
  },
  popularText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.4,
  },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planNameRow: { flex: 1 },
  planName: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 22,
  },
  planTag: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  planDesc: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 18,
  },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  priceSymbol: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginBottom: 10,
  },
  priceValue: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 44,
    lineHeight: 50,
  },
  pricePer: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 12,
    marginLeft: 4,
  },
  freeText: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 40,
  },
  yearlyNote: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
    marginBottom: 6,
  },

  featuresList: { marginTop: 16, marginBottom: 20, gap: 10 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  featureCheck: {
    width: 18,
    height: 18,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  featureText: {
    color: 'rgba(255,255,255,0.88)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  ctaPrimary: {
    backgroundColor: '#fff',
  },
  ctaSecondary: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  ctaCurrent: {
    backgroundColor: 'rgba(52,211,153,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
    paddingVertical: 14,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    letterSpacing: 0.3,
  },

  // FAQ
  faqWrap: { marginTop: 32 },
  faqTitle: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 22,
    marginBottom: 14,
  },
  faqItem: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  faqQ: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 4,
  },
  faqA: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
});
