import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Users, TrendingUp } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { AmbientBackground } from '../src/components/AmbientBackground';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api, MetricRow, VersionAdoption, PlanAdoption, FunnelSummary,
  RetentionSummary, InviteBreakdown, AiHealth, SubscriberList,
  BillingEventLog } from '../src/api';
import { logger } from '../src/logger';

// Admin-only screen — plain English labels are fine (only the owner sees it).
const EVENT_LABELS: Record<string, string> = {
  feed_open: 'Feed opens',
  kids_open: 'Kids screen opens',
  calendar_open: 'Calendar opens',
  scan_used: 'Document scans',
  card_created: 'Tasks created',
  vault_added: 'Documents saved',
  vault_shared: 'Documents shared',
  onboarding_done: 'Onboardings finished',
};
const EVENT_ORDER = Object.keys(EVENT_LABELS);


/**
 * How long ago somebody last used the app, in words.
 *
 * The Subscribers list used to read a push-notification token and print
 * "Never opened" when there wasn't one — so anyone who declined the
 * notification prompt, or used the web app, was reported as never having
 * opened it. Roland appeared in his own list that way.
 *
 * A date is more useful than a badge anyway: "3 weeks ago" tells you something
 * "Active" does not. Null stays honest — it means nothing was recorded, which
 * is not a claim that they never came.
 */
function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'No activity recorded';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'No activity recorded';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'Active today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export default function MetricsScreen() {
  const router = useRouter();
  const { t, user } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [rows, setRows] = useState<MetricRow[]>([]);
  const [adoption, setAdoption] = useState<VersionAdoption | null>(null);
  const [plans, setPlans] = useState<PlanAdoption | null>(null);
  const [subs, setSubs] = useState<SubscriberList | null>(null);
  const [showAllSubs, setShowAllSubs] = useState(false);
  const [billing, setBilling] = useState<BillingEventLog | null>(null);
  const [funnel, setFunnel] = useState<FunnelSummary | null>(null);
  const [retention, setRetention] = useState<RetentionSummary | null>(null);
  const [invites, setInvites] = useState<InviteBreakdown | null>(null);
  const [aiHealth, setAiHealth] = useState<AiHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getMetricsSummary(14);
      setRows(res.rows || []);
      setError(null);
    } catch (e: any) {
      logger.warn('metrics load failed', e?.message || e);
      setError(e?.message || 'Could not load metrics.');
    } finally {
      setLoading(false);
    }
    // OTA adoption is best-effort and separate — a failure here must not blank
    // the usage numbers above it.
    api.getVersionAdoption().then(setAdoption).catch((e) => logger.warn('adoption load failed', e?.message || e));
    // Same for subscription adoption — the "who is actually paying" readout.
    api.getPlanAdoption().then(setPlans).catch((e) => logger.warn('plan adoption load failed', e?.message || e));
    // The per-household list behind those totals — who is on what, with a contact.
    api.getSubscribers().then(setSubs).catch((e) => logger.warn('subscribers load failed', e?.message || e));
    // What the payment providers have actually told us. A sale that never
    // showed up here is the difference between "nobody bought" and "the money
    // arrived and we dropped it" — and those need opposite fixes.
    api.getBillingEvents(40).then(setBilling).catch((e) => logger.warn('billing events load failed', e?.message || e));
    // The activation + growth funnel — the "make the launch stick" scoreboard.
    api.getMetricsFunnel(30).then(setFunnel).catch((e) => logger.warn('funnel load failed', e?.message || e));
    // Retention, counted in ADULTS — the funnel's 2+-members number counts child
    // profiles, so it cannot answer whether a second grown-up actually stuck.
    api.getMetricsRetention(8).then(setRetention).catch((e) => logger.warn('retention load failed', e?.message || e));
    // Why invites do not land — a delivery problem and a broken join look
    // identical in the funnel's acceptance rate and need opposite fixes.
    api.getInviteBreakdown(30).then(setInvites).catch((e) => logger.warn('invite breakdown load failed', e?.message || e));
    // probe=0 (default) — free, reports configured/plumbing state, no token cost.
    api.getAiHealth().then(setAiHealth).catch((e) => logger.warn('ai health load failed', e?.message || e));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const goBack = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.replace('/(tabs)/settings');
  };

  const today = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    const dauByDay = new Map<string, number>();
    const eventTotals = new Map<string, number>();
    for (const r of rows) {
      if (r.name === 'active_users') dauByDay.set(r.date, r.count);
      else eventTotals.set(r.name, (eventTotals.get(r.name) || 0) + r.count);
    }
    const dauValues = [...dauByDay.values()];
    const activeToday = dauByDay.get(today) || 0;
    const peakDau = dauValues.length ? Math.max(...dauValues) : 0;
    const activeDays = dauValues.length;
    // Distinct daily-actives split by platform (summed over the window). Web
    // users can't buy through the store, so this ratio is the first thing to
    // read when subscriptions are flat.
    const platform = {
      web: eventTotals.get('active_web') || 0,
      android: eventTotals.get('active_android') || 0,
      ios: eventTotals.get('active_ios') || 0,
      other: eventTotals.get('active_other') || 0,
    };
    const platformTotal = platform.web + platform.android + platform.ios + platform.other;
    return { activeToday, peakDau, activeDays, eventTotals, platform, platformTotal };
  }, [rows, today]);

  if (user && !user.is_admin) {
    return (
      <View style={styles.container}>
        <AmbientBackground />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <PressScale testID="metrics-back" onPress={goBack} style={styles.backBtn}>
              <ArrowLeft color={ui.text} size={16} />
              <Text style={styles.backText}>{t('back')}</Text>
            </PressScale>
          </View>
          <Text style={styles.adminOnly}>This screen is available to admins only.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <PressScale testID="metrics-back" onPress={goBack} style={styles.backBtn}>
            <ArrowLeft color={ui.text} size={16} />
            <Text style={styles.backText}>{t('back')}</Text>
          </PressScale>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={ui.muted} />}
        >
          <Text style={styles.title}>Usage</Text>
          <Text style={styles.subtitle}>Last 14 days · first-party, count-only</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && rows.length === 0 && !error ? <Text style={styles.muted}>Loading…</Text> : null}

          {/* DAU tiles */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Users color={ui.orange} size={18} />
              <Text style={styles.tileNum}>{stats.activeToday}</Text>
              <Text style={styles.tileLabel}>Active today</Text>
            </View>
            <View style={styles.tile}>
              <TrendingUp color={ui.mintText} size={18} />
              <Text style={styles.tileNum}>{stats.peakDau}</Text>
              <Text style={styles.tileLabel}>Peak day</Text>
            </View>
            <View style={styles.tile}>
              <Text style={[styles.tileNum, { marginTop: 22 }]}>{stats.activeDays}</Text>
              <Text style={styles.tileLabel}>Active days</Text>
            </View>
          </View>

          {/* Activation + growth funnel — the "make the launch stick" scoreboard */}
          <Text style={styles.sectionTitle}>Activation &amp; growth (30 days)</Text>
          {funnel ? (
            <>
              <View style={styles.card}>
                {([
                  ['Signups', funnel.signups, null],
                  ['Finished onboarding', funnel.onboarded, funnel.signups],
                  ['Invites sent', funnel.invites_sent, null],
                  ['Invites accepted', funnel.invites_accepted, funnel.invites_sent],
                  ['Households with 2+ adults', funnel.two_plus_adult_households, null],
                  ['Households that shared', funnel.sharing_households, null],
                  ['Active today', funnel.active_1d, funnel.total_users],
                  ['Active this week', funnel.active_7d, funnel.total_users],
                ] as [string, number, number | null][])
                  .map(([label, n, denom], i) => (
                    <View key={label} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                      <Text style={styles.eventLabel}>{label}</Text>
                      <Text style={styles.eventCount}>
                        {n}{denom && denom > 0 ? ` · ${Math.round((100 * n) / denom)}%` : ''}
                      </Text>
                    </View>
                  ))}
              </View>
              <Text style={styles.hint}>
                Signups → onboarding → invite → a co-parent joins → shares. Invites-accepted and 2+-member households are your growth loop; active-this-week is retention.
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>No funnel data yet — fills in as people sign up and invite.</Text>
          )}

          {/* Invites — the funnel says most are not accepted; this says why. */}
          <Text style={styles.sectionTitle}>Invites — why they don&apos;t land</Text>
          {invites ? (
            <>
              <View style={styles.card}>
                {([
                  ['Sent', invites.status.sent, null],
                  ['Accepted', invites.status.accepted, invites.status.sent],
                  ['Still waiting', invites.status.pending, invites.status.sent],
                  ['Expired unanswered', invites.status.expired, invites.status.sent],
                ] as [string, number, number | null][])
                  .map(([label, n, denom], i) => (
                    <View key={label} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                      <Text style={styles.eventLabel}>{label}</Text>
                      <Text style={styles.eventCount}>
                        {n}{denom && denom > 0 ? ` · ${Math.round((100 * n) / denom)}%` : ''}
                      </Text>
                    </View>
                  ))}
              </View>

              {/* The split that decides what to fix. */}
              <View style={styles.card}>
                {([
                  ['They are in the household', invites.outcome.in_the_household],
                  ['Signed up, never joined', invites.outcome.signed_up_but_not_joined],
                  ['Never signed up at all', invites.outcome.never_signed_up],
                ] as [string, number][])
                  .map(([label, n], i) => (
                    <View key={label} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                      <Text style={styles.eventLabel}>{label}</Text>
                      <Text style={styles.eventCount}>{n}</Text>
                    </View>
                  ))}
              </View>
              <Text style={styles.hint}>
                {'\u201C'}Never signed up{'\u201D'} means the link or the email never reached them, or
                did not persuade them — that is wording and delivery.
                {' '}{'\u201C'}Signed up, never joined{'\u201D'} means they tried and the join failed:
                that is a bug, and it has happened here before when a content blocker
                killed the accept request. Whichever number is larger is the one to work on.
                {invites.outcome.joined_while_invite_still_pending > 0
                  ? ` ${invites.outcome.joined_while_invite_still_pending} joined while the invite still reads pending — real successes the acceptance rate counts as failures.`
                  : ''}
                {invites.status.oldest_pending_days != null
                  ? ` Oldest unanswered invite: ${invites.status.oldest_pending_days} days.`
                  : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>No invite data yet — fills in as invites go out.</Text>
          )}

          {/* Retention — the question the funnel cannot answer. Its
              2+-members count includes child profiles, so a lone parent with
              two kids reads as shared there. This counts ACCOUNTS, and puts
              solo against shared so the theory can be killed by the data. */}
          <Text style={styles.sectionTitle}>Retention — does a second adult keep them?</Text>
          {retention ? (
            <>
              <View style={styles.card}>
                {([
                  ['Households', retention.households.total, null],
                  ['One adult', retention.households.solo_adult, retention.households.total],
                  ['Two or more adults', retention.households.two_plus_adults, retention.households.total],
                  ['…and active this week', retention.households.two_plus_adults_active_7d, retention.households.two_plus_adults],
                  ['Accounts active today', retention.accounts.active_1d, retention.accounts.total],
                  ['Accounts active this week', retention.accounts.active_7d, retention.accounts.total],
                  ['Accounts active this month', retention.accounts.active_30d, retention.accounts.total],
                ] as [string, number, number | null][])
                  .map(([label, n, denom], i) => (
                    <View key={label} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                      <Text style={styles.eventLabel}>{label}</Text>
                      <Text style={styles.eventCount}>
                        {n}{denom && denom > 0 ? ` · ${Math.round((100 * n) / denom)}%` : ''}
                      </Text>
                    </View>
                  ))}
              </View>

              {/* The comparison this screen exists for. */}
              <View style={styles.card}>
                <View style={[styles.eventRow, { borderTopWidth: 0 }]}>
                  <Text style={styles.eventLabel}>Weekly return · one adult</Text>
                  <Text style={styles.eventCount}>
                    {retention.weekly_return_rate.solo_adult_pct == null
                      ? '—' : `${retention.weekly_return_rate.solo_adult_pct}%`}
                  </Text>
                </View>
                <View style={styles.eventRow}>
                  <Text style={styles.eventLabel}>Weekly return · two or more</Text>
                  <Text style={styles.eventCount}>
                    {retention.weekly_return_rate.two_plus_adults_pct == null
                      ? '—' : `${retention.weekly_return_rate.two_plus_adults_pct}%`}
                  </Text>
                </View>
              </View>
              <Text style={styles.hint}>
                If the second line is well above the first, getting a second adult in IS the
                retention strategy and the roadmap follows from it. If they are close, that
                theory is dead and the effort belongs elsewhere. A dash means nobody is in
                that group yet — not zero.
              </Text>

              {retention.cohorts.length > 0 ? (
                <>
                  <Text style={styles.sectionTitle}>Still here, by signup week</Text>
                  <View style={styles.card}>
                    {retention.cohorts.map((c, i) => (
                      <View key={c.week} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                        <Text style={styles.eventLabel}>Week of {c.week}</Text>
                        <Text style={styles.eventCount}>
                          {c.still_active}/{c.signups}
                          {c.retained_pct == null ? '' : ` · ${c.retained_pct}%`}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.hint}>
                    Of the people who joined that week, how many opened the app in the last
                    seven days. A curve that flattens is a product people keep; one that
                    slides to zero is a product they try.
                  </Text>
                </>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>No retention data yet — fills in as people sign up and return.</Text>
          )}

          {/* AI health — every AI feature degrades gracefully, so a broken
              model can fail silently for weeks. This makes it visible: live
              plumbing state + a real success rate from the central call path. */}
          <Text style={styles.sectionTitle}>AI health</Text>
          {(() => {
            const ok = stats.eventTotals.get('ai_call_ok') || 0;
            const err = stats.eventTotals.get('ai_call_error') || 0;
            const total = ok + err;
            const rate = total > 0 ? Math.round((100 * ok) / total) : null;
            const ready = aiHealth ? aiHealth.client_ready : null;
            return (
              <>
                <View style={styles.card}>
                  <View style={[styles.eventRow, { borderTopWidth: 0 }]}>
                    <Text style={styles.eventLabel}>Status</Text>
                    <Text style={[styles.eventCount, ready === false && { color: ui.danger }, ready === true && { color: ui.mintText }]}>
                      {ready === null ? '—' : ready ? 'Ready' : 'Not ready'}
                    </Text>
                  </View>
                  <View style={styles.eventRow}>
                    <Text style={styles.eventLabel}>Success rate (14 days)</Text>
                    <Text style={styles.eventCount}>
                      {rate === null ? 'no calls yet' : `${rate}% · ${ok}/${total}`}
                    </Text>
                  </View>
                  <View style={styles.eventRow}>
                    <Text style={styles.eventLabel}>Failed calls (14 days)</Text>
                    <Text style={[styles.eventCount, err > 0 && { color: ui.danger }]}>{err}</Text>
                  </View>
                  {aiHealth?.model_resolved ? (
                    <View style={styles.eventRow}>
                      <Text style={styles.eventLabel}>Active model</Text>
                      <Text style={styles.eventCount}>{aiHealth.model_resolved}</Text>
                    </View>
                  ) : null}
                  {aiHealth?.last_error ? (
                    <View style={styles.eventRow}>
                      <Text style={styles.eventLabel}>Last error</Text>
                      <Text style={[styles.eventCount, { color: ui.danger, flexShrink: 1, textAlign: 'right' }]} numberOfLines={2}>
                        {aiHealth.last_error}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.hint}>
                  Covers every AI feature (recipes, scans, suggestions) — they all
                  route through one call path. A dropping success rate or a
                  standing last-error means users are hitting failures.
                </Text>
              </>
            );
          })()}

          {/* Where users are — web can't buy through the store */}
          <Text style={styles.sectionTitle}>Where users are</Text>
          {stats.platformTotal > 0 ? (
            <>
              <View style={styles.card}>
                {([
                  ['Android app', stats.platform.android],
                  ['iPhone app', stats.platform.ios],
                  ['Web browser', stats.platform.web],
                  ['Other', stats.platform.other],
                ] as [string, number][])
                  .filter(([, n], i) => n > 0 || i < 3)
                  .map(([label, n], i) => (
                    <View key={label} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                      <Text style={styles.eventLabel}>{label}</Text>
                      <Text style={styles.eventCount}>
                        {n} · {Math.round((100 * n) / stats.platformTotal)}%
                      </Text>
                    </View>
                  ))}
              </View>
              <Text style={styles.hint}>
                Distinct active users by platform, last 14 days. Purchases only work in the Android/iPhone app — anyone on web sees &quot;coming soon&quot; and can&apos;t subscribe.
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>No platform data yet — appears as people open the app on the new build.</Text>
          )}

          {/* Event totals */}
          <Text style={styles.sectionTitle}>Feature usage (totals)</Text>
          <View style={styles.card}>
            {EVENT_ORDER.map((name, i) => (
              <View key={name} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                <Text style={styles.eventLabel}>{EVENT_LABELS[name]}</Text>
                <Text style={styles.eventCount}>{stats.eventTotals.get(name) || 0}</Text>
              </View>
            ))}
          </View>

          {/* Subscriptions — who is actually paying vs. getting Premium free */}
          <Text style={styles.sectionTitle}>Subscriptions</Text>
          {plans ? (
            <>
              {!plans.billing_live ? (
                <View style={[styles.card, styles.warnCard]}>
                  <Text style={styles.warnText}>
                    Billing is OFF (RC_WEBHOOK_SECRET not set). Every household is on Premium for free and no paywall fires — set it in Railway before reading conversion.
                  </Text>
                </View>
              ) : null}
              <View style={styles.tileRow}>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{plans.active_paying_families}</Text>
                  <Text style={styles.tileLabel}>Paying households</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{plans.pct_active_paying}%</Text>
                  <Text style={styles.tileLabel}>of active households</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{plans.active_free_premium_families}</Text>
                  <Text style={styles.tileLabel}>Free Premium</Text>
                </View>
              </View>
              <View style={styles.card}>
                <View style={[styles.eventRow, { borderTopWidth: 0 }]}>
                  <Text style={styles.eventLabel}>Active households (opened app)</Text>
                  <Text style={styles.eventCount}>{plans.active_families}</Text>
                </View>
                <View style={styles.eventRow}>
                  <Text style={styles.eventLabel}>Households with a device registered</Text>
                  <Text style={styles.eventCount}>{plans.families_with_a_device}</Text>
                </View>
                <View style={styles.eventRow}>
                  <Text style={styles.eventLabel}>Total households (incl. never-opened)</Text>
                  <Text style={styles.eventCount}>{plans.total_families}</Text>
                </View>
                <View style={styles.eventRow}>
                  <Text style={styles.eventLabel}>Tester households (share Premium)</Text>
                  <Text style={styles.eventCount}>{plans.tester_households}</Text>
                </View>
                {Object.entries(plans.by_stored_plan).map(([plan, n]) => (
                  <View key={plan} style={styles.eventRow}>
                    <Text style={styles.eventLabel}>Stored plan · {plan}</Text>
                    <Text style={styles.eventCount}>{n}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.hint}>
                &quot;Paying&quot; counts households whose stored plan is a paid tier (a real purchase). &quot;Free Premium&quot; get paid features without paying — via the testing window or a tester household — so they never see a paywall.
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>No subscription data yet.</Text>
          )}

          {/* Subscribers — the per-household list behind those totals */}
          {subs && subs.subscribers.length ? (
            <>
              <Text style={styles.sectionTitle}>Subscribers</Text>
              <Text style={styles.hint}>
                {subs.paying} paying of {subs.total} households. Paying first. Contact is the household&apos;s creator.
              </Text>
              <View style={styles.card}>
                {(showAllSubs ? subs.subscribers : subs.subscribers.slice(0, 12)).map((s, i) => (
                  <View key={s.family_id} style={[styles.subRow, i === 0 && { borderTopWidth: 0 }]}>
                    <View style={styles.subLeft}>
                      <Text style={styles.subName} numberOfLines={1}>
                        {s.owner_name || '(no name)'}
                      </Text>
                      <Text style={styles.subEmail} numberOfLines={1}>
                        {s.owner_email || '—'}
                      </Text>
                    </View>
                    <View style={styles.subRight}>
                      <View style={[styles.subTag, s.paying ? styles.subTagPaid : styles.subTagFree]}>
                        <Text style={[styles.subTagText, { color: s.paying ? ui.orangeText : ui.muted }]}>
                          {s.paying
                            ? `Premium${s.billing_cycle ? ' · ' + s.billing_cycle : ''}`
                            : 'Free'}
                        </Text>
                      </View>
                      <Text style={styles.subMeta} numberOfLines={1}>
                        {s.paying
                          ? (s.billing_source === 'stripe' ? 'Card (Stripe)'
                             : s.billing_source === 'google_play' ? 'Google Play' : '—')
                          : lastSeenLabel(s.last_active)}
                      </Text>
                    </View>
                  </View>
                ))}
                {subs.subscribers.length > 12 ? (
                  <PressScale onPress={() => setShowAllSubs((v) => !v)} style={styles.subMoreBtn}>
                    <Text style={styles.subMoreText}>
                      {showAllSubs ? 'Show fewer' : `Show all ${subs.subscribers.length}`}
                    </Text>
                  </PressScale>
                ) : null}
              </View>
            </>
          ) : null}


          {/* Billing events — did the money actually reach us */}
          <Text style={styles.sectionTitle}>Billing events</Text>
          {billing ? (
            <>
              {!billing.ever_received ? (
                <View style={[styles.card, styles.warnCard]}>
                  <Text style={styles.warnText}>
                    No billing event has EVER reached this server. Either the webhook is not
                    pointed at /api/billing/revenuecat-webhook, or its secret is unset and every
                    event is being refused. A purchase made now would not lift anyone&apos;s plan.
                  </Text>
                </View>
              ) : billing.unmatched > 0 ? (
                <View style={[styles.card, styles.warnCard]}>
                  <Text style={styles.warnText}>
                    {billing.unmatched} event{billing.unmatched === 1 ? '' : 's'} arrived that we
                    could not match to a household. That is real money landing nowhere — the store
                    got a 200 back and will not send it again.
                  </Text>
                </View>
              ) : null}
              <View style={styles.tileRow}>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{billing.total}</Text>
                  <Text style={styles.tileLabel}>Events recorded</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{billing.unmatched}</Text>
                  <Text style={styles.tileLabel}>Reached nobody</Text>
                </View>
              </View>
              <Text style={styles.hint}>
                Play via RevenueCat: {billing.revenuecat_configured ? 'on' : 'OFF'} · Card via
                Stripe: {billing.stripe_configured ? 'on' : 'OFF'} · Self-heal sweep:{' '}
                {billing.sweep_enabled ? 'on' : 'OFF'}
                {billing.last_event_at ? ` · last event ${billing.last_event_at.slice(0, 16).replace('T', ' ')}` : ''}
              </Text>
              {billing.events.length ? (
                <View style={styles.card}>
                  {billing.events.slice(0, 12).map((e, i) => (
                    <View key={`${e.received_at}-${i}`} style={[styles.subRow, i === 0 && { borderTopWidth: 0 }]}>
                      <View style={styles.subLeft}>
                        <Text style={styles.subName} numberOfLines={1}>
                          {e.event_type || '(no type)'}
                        </Text>
                        <Text style={styles.subEmail} numberOfLines={1}>
                          {e.detail || e.product_id || e.app_user_id || '—'}
                        </Text>
                      </View>
                      <View style={styles.subRight}>
                        <View style={[styles.subTag, e.matched ? styles.subTagPaid : styles.subTagFree]}>
                          <Text style={[styles.subTagText, { color: e.matched ? ui.orangeText : ui.danger }]}>
                            {e.matched ? (e.plan || 'applied') : 'reached nobody'}
                          </Text>
                        </View>
                        <Text style={styles.subMeta} numberOfLines={1}>
                          {e.source}{e.received_at ? ` · ${e.received_at.slice(5, 16).replace('T', ' ')}` : ''}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>No billing data yet.</Text>
          )}

          {/* OTA adoption — who is on the runtime that can receive updates */}
          <Text style={styles.sectionTitle}>Update adoption</Text>
          {adoption ? (
            <>
              <View style={styles.tileRow}>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{adoption.pct_on_current_runtime}%</Text>
                  <Text style={styles.tileLabel}>On runtime {adoption.current_runtime}</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileNum}>{adoption.users_on_current_runtime}/{adoption.total_users_with_a_device}</Text>
                  <Text style={styles.tileLabel}>Users can get OTA</Text>
                </View>
              </View>
              <Text style={styles.hint}>
                Only devices on runtime {adoption.current_runtime} (store build {adoption.store_version}) receive over-the-air updates. Others update via the Play Store.
              </Text>
              <View style={styles.card}>
                {Object.entries(adoption.by_app_version).map(([ver, n], i) => (
                  <View key={ver} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                    <Text style={styles.eventLabel}>Build {ver === 'unknown' ? '— (pre-telemetry)' : ver}</Text>
                    <Text style={styles.eventCount}>{n}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.hint}>
                {adoption.devices_reporting_version}/{adoption.devices_seen} devices report their build. Counts are distinct users, updated as people open the app.
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>No device versions reported yet. Numbers appear as people on the new build open the app.</Text>
          )}

          {!loading && rows.length === 0 && !error ? (
            <Text style={styles.muted}>No activity recorded yet. Numbers appear as testers use the app.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  safe: { flex: 1 },
  topBar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 32, letterSpacing: -0.5, marginTop: 8 },
  subtitle: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 4, marginBottom: 22 },
  error: { color: ui.danger, fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 16 },
  muted: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 16, lineHeight: 20 },
  hint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 10, lineHeight: 18 },
  adminOnly: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 18, padding: 16, gap: 6 },
  tileNum: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30, letterSpacing: -0.5 },
  tileLabel: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  sectionTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18, marginTop: 28, marginBottom: 12 },
  card: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingHorizontal: 16 },
  warnCard: { paddingVertical: 14, marginBottom: 12, borderColor: ui.danger },
  warnText: { color: ui.danger, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19 },
  eventRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: ui.line },
  eventLabel: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  eventCount: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  subRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: ui.line },
  subLeft: { flex: 1, minWidth: 0, gap: 2 },
  subName: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  subEmail: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },
  subRight: { alignItems: 'flex-end', gap: 4 },
  subTag: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4 },
  subTagPaid: { backgroundColor: ui.orangeSoft },
  subTagFree: { backgroundColor: ui.soft },
  subTagText: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.3 },
  subMeta: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11 },
  subMoreBtn: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: ui.line, alignItems: 'center' },
  subMoreText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13 },
});
