import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Sparkles,
  Users,
  Check,
  Crown,
  Briefcase,
  Gem,
  Lock,
} from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, Plan, BillingCycle, bustSubscriptionCache } from '../api';
import { purchasePremium, restorePurchases } from '../billing';

// Where a web (or billing-less) user is sent to actually subscribe. Store
// billing only exists in the native app, so on web the purchase and restore
// paths point here instead of dead-ending on "coming soon".
const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.householdcoo.app';

// Three tiers: Free (Village) + Family (executive) + Household.
const PLAN_ORDER: Plan[] = ['village', 'executive', 'household'];

const PLAN_PRICES: Record<Plan, { monthly: number; yearly: number }> = {
  village: { monthly: 0, yearly: 0 },
  executive: { monthly: 6.99, yearly: 49.99 },
  household: { monthly: 14.99, yearly: 149.99 },
  family_office: { monthly: 19.99, yearly: 179.99 },
};

// Which Stripe tier a plan buys through. Family = the executive plan.
const PLAN_TO_TIER: Partial<Record<Plan, 'family' | 'household'>> = {
  executive: 'family',
  household: 'household',
};

interface Props {
  embedded?: boolean;
  onAuthRequired?: () => void;
}

export function PricingView({ embedded = false, onAuthRequired }: Props) {
  const { t, subscription, user, refreshSubscription } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [busy, setBusy] = useState(false);
  // The Stripe config (web only): whether card checkout is on, and which tiers
  // are buyable yet. Null until asked.
  const [stripeCfg, setStripeCfg] = useState<Awaited<ReturnType<typeof api.getStripeConfig>> | null>(null);
  const currentPlan: Plan = subscription?.plan ?? 'village';
  const onWeb = Platform.OS === 'web';
  const tierBuyable = (plan: Plan): boolean => {
    const tier = PLAN_TO_TIER[plan];
    if (!tier || !stripeCfg?.enabled) return false;
    return stripeCfg.tiers?.[tier]?.buyable ?? (tier === 'family');
  };
  // The polling loop after a Stripe return needs the freshest subscription, not
  // the one closed over when the effect started. A ref, kept current by an
  // effect, is.
  const subRef = useRef(subscription);
  useEffect(() => {
    subRef.current = subscription;
  }, [subscription]);

  const handleChoose = async (plan: Plan) => {
    if (!user) {
      onAuthRequired?.();
      return;
    }

    if (plan === currentPlan) {
      Alert.alert(t('price_current_plan_title'), t('price_current_plan_msg'));
      return;
    }

    // Downgrades are managed in the Play Store subscription screen, not here.
    if (plan === 'village') {
      Alert.alert(t('price_downgrade_title'), t('price_downgrade_msg'));
      return;
    }

    if (busy) return;
    setBusy(true);
    try {
      // Web (an iPhone in Safari, a laptop) has no store billing. Pay by card
      // through Stripe: fetch a hosted Checkout URL and hand the browser over.
      if (onWeb) {
        const tier = PLAN_TO_TIER[plan];
        if (!tier || !tierBuyable(plan)) {
          // This tier isn't buyable here yet (Stripe off, or this tier's prices
          // not set up) — point to Google Play rather than dead-ending.
          Alert.alert(
            t('price_get_app_title'),
            t('price_get_app_msg'),
            [
              { text: t('cancel'), style: 'cancel' },
              { text: t('price_get_app_cta'), onPress: () => { Linking.openURL(ANDROID_STORE_URL).catch(() => undefined); } },
            ],
          );
          return;
        }
        try {
          const res = await api.createStripeCheckout(tier, cycle);
          if (res.url && typeof window !== 'undefined') {
            window.location.href = res.url;
            return;
          }
          Alert.alert(t('price_purchase_failed_title'), t('price_purchase_failed_msg'));
        } catch {
          Alert.alert(t('price_purchase_failed_title'), t('price_purchase_failed_msg'));
        }
        return;
      }

      // Native (Android). The store today carries the Family subscription only;
      // Household isn't a Play product yet, so buy it on the web (Stripe) for
      // now rather than dead-ending on a missing product.
      if (plan === 'household') {
        Alert.alert(t('price_household_web_title'), t('price_household_web_msg'));
        return;
      }

      const res = await purchasePremium(user.user_id, cycle);
      if (!res.available) {
        // No store billing here — almost always because this is the web app.
        // Don't dead-end: offer to open Google Play, where subscribing works.
        Alert.alert(
          t('price_get_app_title'),
          t('price_get_app_msg'),
          [
            { text: t('cancel'), style: 'cancel' },
            { text: t('price_get_app_cta'), onPress: () => { Linking.openURL(ANDROID_STORE_URL).catch(() => undefined); } },
          ],
        );
        return;
      }
      if (res.cancelled) return;
      if (res.ok && res.premium) {
        await refreshSubscription().catch(() => undefined);
        Alert.alert(t('price_purchase_done_title'), t('price_purchase_done_msg'));
      } else {
        Alert.alert(t('price_purchase_failed_title'), t('price_purchase_failed_msg'));
      }
    } finally {
      setBusy(false);
    }
  };

  // What the store knows, not what the backend last heard. Plan state here
  // comes from a RevenueCat webhook, so a single missed event leaves a paying
  // customer looking like a free one — offered an upgrade they already bought,
  // and gated out of features they are paying for. Reconciling quietly on open
  // means the screen shows the truth before it offers anything.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!user || syncedRef.current) return;
    syncedRef.current = true;
    (async () => {
      try {
        // Is card checkout available here? Only the web app asks — native pays
        // through the store.
        if (onWeb) {
          api.getStripeConfig().then(setStripeCfg).catch(() => setStripeCfg(null));
        }
        // Two corrections, both quiet: the device replays its receipts, and
        // the server asks RevenueCat directly. Either alone heals a missed
        // webhook; together they cover a fresh device with no receipts too.
        await api.reconcileBilling().catch(() => undefined);
        await restorePurchases(user.user_id).catch(() => undefined);
        // Either correction may have changed the stored plan — re-read it.
        await refreshSubscription().catch(() => undefined);
      } catch {
        // Best effort. A device with no billing, or offline, just sees the
        // plan the backend already believed — never an error for something
        // the person did not ask for.
      }
    })();
  }, [user, refreshSubscription, onWeb]);

  // Coming back from a Stripe Checkout page (?checkout=success). The webhook
  // that lifts the plan can land a beat after the redirect, so poll the
  // subscription a few times before celebrating, then tidy the URL.
  const checkoutHandledRef = useRef(false);
  useEffect(() => {
    if (!onWeb || checkoutHandledRef.current || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return;
    checkoutHandledRef.current = true;
    // Drop the query param so a refresh does not replay this.
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch {
      // Non-fatal; the param just lingers.
    }
    if (status !== 'success') return;
    (async () => {
      for (let i = 0; i < 6; i++) {
        bustSubscriptionCache();
        await refreshSubscription().catch(() => undefined);
        if (subRef.current?.plan === 'executive') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      Alert.alert(t('price_purchase_done_title'), t('price_purchase_done_msg'));
    })();
  }, [onWeb, refreshSubscription, t]);

  const handleRestore = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const res = await restorePurchases(user.user_id);
      if (!res.available) {
        // Same as purchase: restoring only works in the app. Point there.
        Alert.alert(
          t('price_get_app_title'),
          t('price_get_app_msg'),
          [
            { text: t('cancel'), style: 'cancel' },
            { text: t('price_get_app_cta'), onPress: () => { Linking.openURL(ANDROID_STORE_URL).catch(() => undefined); } },
          ],
        );
        return;
      }
      if (res.ok && res.premium) {
        await refreshSubscription().catch(() => undefined);
        Alert.alert(t('price_purchase_done_title'), t('price_purchase_done_msg'));
      } else {
        Alert.alert(t('price_restore_title'), t('price_restore_none'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, embedded && { paddingTop: 0 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.badge}>
            <Sparkles color={ui.text} size={12} />
            <Text style={styles.badgeText}>{t('price_badge_plans')}</Text>
          </View>
          <Text style={styles.title}>{t('price_header_title')}</Text>
          <Text style={styles.subtitle}>{t('price_header_subtitle')}</Text>
        </View>

        <View>
          <BillingToggle value={cycle} onChange={setCycle} t={t} styles={styles} />
          <Text style={styles.billingNote}>
            {t('price_billing_note')}
          </Text>
          {user ? (
            <PressScale onPress={handleRestore} disabled={busy} style={styles.restoreLink}>
              <Text style={styles.restoreLinkText}>{t('price_restore_title')}</Text>
            </PressScale>
          ) : null}
        </View>

        <View style={styles.cardsContainer}>
          {PLAN_ORDER.map((plan) => (
            <View key={plan}>
              <PlanCard
                plan={plan}
                cycle={cycle}
                isCurrent={plan === currentPlan}
                onChoose={() => handleChoose(plan)}
                showCurrentBadge={plan === currentPlan}
                t={t}
                styles={styles}
                ui={ui}
              />
            </View>
          ))}
        </View>

        <View style={styles.faqWrap}>
          <Text style={styles.faqTitle}>{t('price_faq_title')}</Text>
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
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function BillingToggle({
  value,
  onChange,
  t,
  styles,
}: {
  value: BillingCycle;
  onChange: (v: BillingCycle) => void;
  t: (k: string, p?: any) => string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.toggleContainer}>
      <View style={styles.toggleTrack}>
        <View style={[styles.togglePill, value === 'yearly' && styles.togglePillYearly]} />
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
        <View style={styles.savingsBadge}>
          <Text style={styles.savingsText}>{t('pricing_save_20')}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PlanCard({
  plan,
  cycle,
  isCurrent,
  onChoose,
  showCurrentBadge,
  t,
  styles,
  ui,
}: {
  plan: Plan;
  cycle: BillingCycle;
  isCurrent: boolean;
  onChoose: () => void;
  showCurrentBadge: boolean;
  t: (k: string, p?: any) => string;
  styles: ReturnType<typeof createStyles>;
  ui: UIColors;
}) {
  const price = PLAN_PRICES[plan][cycle];
  const perMonth = cycle === 'yearly' ? price / 12 : price;
  const priceDisplay = cycle === 'yearly' ? perMonth : price;
  const isFree = plan === 'village';
  const isMiddle = plan === 'executive';

  const theme = PLAN_THEMES[plan];
  const Icon = theme.icon;

  return (
    <View
      style={[
        styles.card,
        isMiddle && styles.cardFeatured,
      ]}
    >
      <LinearGradient
        colors={theme.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

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

      <View style={styles.priceRow}>
        {isFree ? (
          <Text style={styles.freeText}>{t('price_free')}</Text>
        ) : (
          <>
            <Text style={styles.priceSymbol}>€</Text>
            <Text style={styles.priceValue}>
              {priceDisplay.toFixed(priceDisplay % 1 === 0 ? 0 : 2)}
            </Text>
            <Text style={styles.pricePer}>{t('pricing_per_month')}</Text>
          </>
        )}
      </View>
      {!isFree && cycle === 'yearly' ? (
        <Text style={styles.yearlyNote}>
          €{price.toFixed(2)} {t('pricing_billed_yearly')}
        </Text>
      ) : null}

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

      {/* The free plan shows the kitchen as a see-through locked door, not a
          hidden wall: visible enough to create the want, with no free usage. */}
      {isFree ? (
        <View style={styles.lockedRow}>
          <View style={styles.lockedCheck}>
            <Lock color={ui.muted} size={11} />
          </View>
          <Text style={styles.lockedText}>{t('pf_locked_kitchen')}</Text>
          <View style={styles.lockedChip}>
            <Text style={styles.lockedChipText}>{t('plan_executive')}</Text>
          </View>
        </View>
      ) : null}

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
            isFree ? styles.ctaDisabled : styles.ctaUpgrade,
          ]}
        >
          {isFree ? null : <Crown color="#fff" size={14} />}
          {/* The free plan's button sits on a themed surface, so its label must
              follow the theme; the Premium button keeps white on orange. */}
          <Text style={[styles.ctaText, isFree ? styles.ctaTextThemed : styles.ctaTextOnAccent]}>
            {isFree ? t('pricing_get_started') : t('pricing_upgrade')}
          </Text>
        </PressScale>
      )}
    </View>
  );
}

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
    iconColor: '#6366F1',
    gradient: ['rgba(99,102,241,0.10)', 'rgba(99,102,241,0.04)'] as const,
    features: [
      'pf_free_1',
      'pf_free_2',
      'pf_free_3',
      'pf_free_4',
      'pf_free_5',
      'pf_free_6',
    ],
  },
  executive: {
    icon: Briefcase,
    iconBg: 'rgba(16,185,129,0.18)',
    iconColor: '#059669',
    gradient: ['rgba(16,185,129,0.15)', 'rgba(99,102,241,0.15)'] as const,
    features: [
      'pf_prem_1',
      'pf_prem_2',
      'pf_prem_3',
      'pf_prem_4',
      'pf_prem_5',
      'pf_prem_6',
    ],
  },
  household: {
    icon: Gem,
    iconBg: 'rgba(236,72,153,0.18)',
    iconColor: '#F472B6',
    gradient: ['rgba(236,72,153,0.12)', 'rgba(139,92,246,0.12)'] as const,
    features: [
      'pf_house_1',
      'pf_house_2',
      'pf_house_3',
      'pf_house_4',
      'pf_house_5',
      'pf_house_6',
    ],
  },
  // Legacy tier kept only so an admin household (stored "family_office") still
  // resolves to a theme; never shown in PLAN_ORDER.
  family_office: {
    icon: Gem,
    iconBg: 'rgba(236,72,153,0.18)',
    iconColor: '#F472B6',
    gradient: ['rgba(236,72,153,0.12)', 'rgba(139,92,246,0.12)'] as const,
    features: [
      'pf_house_1',
      'pf_house_2',
      'pf_house_3',
      'pf_house_4',
      'pf_house_5',
      'pf_house_6',
    ],
  },
};

// Page chrome (header, toggle, notes, FAQ) follows the active theme; the plan
// cards themselves are intentionally dark in both themes, so their inner
// colors stay fixed.
const createStyles = (ui: UIColors) => StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },
  header: { alignItems: 'flex-start', marginBottom: 20 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: ui.soft,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 9999,
    marginBottom: 16,
  },
  badgeText: {
    color: ui.text,
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: ui.text,
    fontSize: 34,
    lineHeight: 40,
  },
  subtitle: {
    color: ui.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    marginTop: 6,
  },
  toggleContainer: {
    alignItems: 'center',
    marginVertical: 22,
    position: 'relative',
  },
  toggleTrack: {
    flexDirection: 'row',
    backgroundColor: ui.soft,
    borderWidth: 1,
    borderColor: ui.line,
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
    backgroundColor: ui.text,
  },
  togglePillYearly: { left: 104 },
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
    color: ui.muted,
  },
  toggleTextActive: { color: ui.bg },
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
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  restoreLink: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  restoreLinkText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13 },
  savingsText: {
    color: ui.mintText,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  cardsContainer: { gap: 14 },
  card: {
    position: 'relative',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 22,
    overflow: 'hidden',
    // Solid base so the translucent gradients render over a readable surface
    // (previously the cards relied on a BlurView that rendered as a grey
    // "glass mirror" sheet on Android). Theme-driven so the pricing screen —
    // the one place we ask for money — doesn't render dark cards on the light
    // canvas its own wrapper paints.
    backgroundColor: ui.card,
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
    color: ui.text,
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 22,
  },
  planTag: {
    color: ui.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  planDesc: {
    color: ui.muted,
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
    color: ui.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    marginBottom: 10,
  },
  priceValue: {
    color: ui.text,
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 44,
    lineHeight: 50,
  },
  pricePer: {
    color: ui.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 12,
    marginLeft: 4,
  },
  freeText: {
    color: ui.text,
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 40,
  },
  yearlyNote: {
    color: ui.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
    marginBottom: 6,
  },
  featuresList: { marginTop: 16, marginBottom: 20, gap: 10 },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -8, marginBottom: 18 },
  lockedCheck: {
    width: 18,
    height: 18,
    borderRadius: 9999,
    backgroundColor: ui.soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedText: {
    color: ui.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },
  lockedChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 9999,
    backgroundColor: 'rgba(245,101,25,0.14)',
  },
  lockedChipText: {
    color: ui.orangeText,
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  featureCheck: {
    width: 18,
    height: 18,
    borderRadius: 9999,
    backgroundColor: ui.soft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  featureText: {
    color: ui.text,
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
  ctaDisabled: {
    backgroundColor: ui.soft,
    borderWidth: 1,
    borderColor: ui.line,
  },
  ctaUpgrade: {
    backgroundColor: '#F56519',
  },
  // Label colours for the two CTA surfaces: themed text on the free plan's
  // neutral button, white on the orange Premium button.
  ctaTextThemed: { color: ui.text },
  ctaTextOnAccent: { color: '#fff' },
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
  faqWrap: { marginTop: 32 },
  faqTitle: {
    color: ui.text,
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 22,
    marginBottom: 14,
  },
  faqItem: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: ui.line,
  },
  faqQ: {
    color: ui.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 4,
  },
  faqA: {
    color: ui.muted,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
});
