import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Gift, Check, Users, Link2 } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { usePremiumGate } from '../src/components/PremiumGate';
import { api, GiftPot } from '../src/api';
import { logger } from '../src/logger';

/**
 * The Gift Pot — one shared present instead of five small ones. Reached from a
 * birthday's Feed nudge or its Calendar event. It coordinates who is chipping
 * in and how much; it moves no money (families settle however they already do).
 *
 * A Family feature: a free household lands here from the nudge, taps "Start",
 * and hits the upgrade prompt — the funnel — rather than a dead end.
 *
 * Params: potId (open an existing pot) OR cardId+name+date (offer to start one).
 */
export default function GiftPotRoute() {
  const ui = useUI();
  const router = useRouter();
  const { t } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const params = useLocalSearchParams<{ potId?: string; cardId?: string; name?: string }>();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pot, setPot] = useState<GiftPot | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('10');
  const locked = isLocked('gift_pot');

  useEffect(() => setReady(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (params.potId) {
        setPot(await api.getGiftPot(String(params.potId)));
      } else if (params.cardId) {
        // Is there already a pot for this birthday card?
        const all = await api.listGiftPots().catch(() => []);
        const found = all.find((p) => p.card_id === String(params.cardId));
        setPot(found || null);
      }
    } catch (e) {
      logger.warn('gift pot load failed', e);
      setPot(null);
    } finally {
      setLoading(false);
    }
  }, [params.potId, params.cardId]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  // Pre-fill the amount with what you've already pledged, so "Update" starts
  // from your real current pledge instead of a blank default that would
  // silently overwrite it with €10.
  useEffect(() => {
    if (pot?.your_amount != null) setAmount(String(pot.your_amount));
    else if (pot) setAmount(String(pot.per_head || 10));
  }, [pot?.pot_id, pot?.your_amount, pot?.per_head]);

  const startPot = useCallback(async () => {
    if (locked) { promptUpgrade('gift_pot'); return; }
    setBusy(true);
    try {
      const created = await api.createGiftPot({
        card_id: params.cardId ? String(params.cardId) : undefined,
        title: params.name ? String(params.name) : undefined,
        per_head: 10,
      });
      setPot(created);
    } catch (e) {
      if ((e as { status?: number })?.status === 402) { promptUpgrade('gift_pot'); }
      else logger.warn('start pot failed', e);
    } finally {
      setBusy(false);
    }
  }, [locked, promptUpgrade, params.cardId, params.name]);

  const chipIn = useCallback(async () => {
    if (!pot) return;
    const value = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100) / 100;
    setBusy(true);
    try {
      setPot(await api.chipInGiftPot(pot.pot_id, value));
    } catch (e) {
      if ((e as { status?: number })?.status === 402) promptUpgrade('gift_pot');
      else logger.warn('chip in failed', e);
    } finally {
      setBusy(false);
    }
  }, [pot, amount, promptUpgrade]);

  const markSorted = useCallback(async () => {
    if (!pot) return;
    setBusy(true);
    try { setPot(await api.closeGiftPot(pot.pot_id)); }
    catch (e) { logger.warn('close pot failed', e); }
    finally { setBusy(false); }
  }, [pot]);

  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const potLink = (token: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}/app/pot/${token}`;
    }
    return `https://ahenora.com/app/pot/${token}`;
  };

  // Turn on (or reuse) the share link and hand it out — the outer circle.
  const inviteOthers = useCallback(async () => {
    if (!pot) return;
    setBusy(true);
    try {
      const updated = pot.share_token ? pot : await api.shareGiftPot(pot.pot_id);
      setPot(updated);
      const url = potLink(updated.share_token as string);
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareMsg(t('gp_link_copied'));
      } else {
        await Share.share({ message: `${t('gp_share_message', { title: updated.title })}\n\n${url}`, url });
      }
    } catch (e) {
      if ((e as { status?: number })?.status === 402) promptUpgrade('gift_pot');
      else logger.warn('share pot failed', e);
    } finally {
      setBusy(false);
    }
  }, [pot, t, promptUpgrade]);

  const togglePaid = useCallback(async (contribId: string, paid: boolean) => {
    if (!pot) return;
    try { setPot(await api.setContributionPaid(pot.pot_id, contribId, paid)); }
    catch (e) { logger.warn('mark paid failed', e); }
  }, [pot]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  if (!ready) return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']} />;

  const name = pot?.title || (params.name ? String(params.name) : t('gp_the_gift'));
  const target = pot?.target_total ?? (pot ? pot.per_head * Math.max(pot.contributor_count, 2) : 0);
  const pct = pot && target > 0 ? Math.min(1, pot.total_pledged / target) : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale testID="gift-pot-back" onPress={goBack} style={styles.backBtn} accessibilityLabel={t('back')}>
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <Text style={styles.headTitle} numberOfLines={1}>{t('gp_title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>
      ) : !pot ? (
        // ---- No pot yet: offer to start one ------------------------------
        <View style={styles.center}>
          <View style={styles.bigIcon}><Gift color={ui.orangeText} size={34} /></View>
          <Text style={styles.startTitle}>{t('gp_start_title', { name })}</Text>
          <Text style={styles.startBody}>{t('gp_start_body')}</Text>
          <PressScale testID="gift-pot-start" onPress={startPot} disabled={busy} style={styles.cta}>
            <Text style={styles.ctaText}>{t('gp_start_cta')}</Text>
          </PressScale>
          {locked ? <Text style={styles.lockNote}>{t('gp_family_note')}</Text> : null}
        </View>
      ) : (
        // ---- The pot -----------------------------------------------------
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <View style={styles.bigIcon}><Gift color={ui.orangeText} size={30} /></View>
            <Text style={styles.amount}>
              {t('gp_money', { amount: String(pot.total_pledged) })}
              <Text style={styles.amountOf}>  {t('gp_of', { amount: String(Math.round(target)) })}</Text>
            </Text>
            <Text style={styles.meta}>
              {t('gp_per_head', { amount: String(pot.per_head) })} · {pot.contributor_count === 1 ? t('gp_n_in_one') : t('gp_n_in', { n: String(pot.contributor_count) })}
            </Text>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} /></View>
            {pot.status === 'closed' ? (
              <View style={styles.sortedPill}><Check color={ui.mintText} size={14} /><Text style={styles.sortedText}>{t('gp_sorted')}</Text></View>
            ) : null}
          </View>

          {/* Who's in */}
          <Text style={styles.sectionLabel}>{t('gp_whos_in')}</Text>
          <View style={styles.card}>
            {pot.contributions.length === 0 ? (
              <Text style={styles.emptyRow}>{t('gp_nobody_yet')}</Text>
            ) : pot.contributions.map((c) => (
              <View key={c.contrib_id} style={styles.row}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(c.name || '?').slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {c.name}{c.source === 'link' ? <Text style={styles.viaLink}>  · {t('gp_via_link')}</Text> : null}
                  </Text>
                  {c.method ? <Text style={styles.rowMethod}>{t(`gp_method_${c.method}`)}</Text> : null}
                </View>
                <Text style={styles.rowAmount}>{t('gp_money', { amount: String(c.amount) })}</Text>
                {/* The organiser marks who has actually settled up. */}
                <PressScale
                  testID={`gift-pot-paid-${c.contrib_id}`}
                  onPress={() => togglePaid(c.contrib_id, !c.paid)}
                  style={[styles.paidToggle, c.paid && styles.paidToggleOn]}
                  accessibilityLabel={c.paid ? t('gp_paid') : t('gp_mark_paid')}
                >
                  <Check color={c.paid ? '#fff' : ui.muted} size={14} />
                </PressScale>
              </View>
            ))}
          </View>

          {/* Invite others — the outer circle. Anyone with the link can chip in
              without joining the household. */}
          {pot.status !== 'closed' ? (
            <PressScale testID="gift-pot-invite" onPress={inviteOthers} disabled={busy} style={styles.inviteBtn}>
              {pot.shared ? <Link2 color={ui.orangeText} size={16} /> : <Users color={ui.orangeText} size={16} />}
              <Text style={styles.inviteBtnText}>{pot.shared ? t('gp_copy_link') : t('gp_invite_others')}</Text>
            </PressScale>
          ) : null}
          {shareMsg ? <Text style={styles.shareMsg}>{shareMsg}</Text> : null}

          {/* Chip in */}
          {pot.status !== 'closed' ? (
            <View style={styles.card}>
              <Text style={styles.chipLabel}>
                {pot.your_amount != null ? t('gp_your_pledge') : t('gp_chip_label')}
              </Text>
              <View style={styles.chipRow}>
                <View style={styles.inputWrap}>
                  <Text style={styles.euro}>€</Text>
                  <TextInput
                    testID="gift-pot-amount"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    style={styles.input}
                    placeholder="10"
                    placeholderTextColor={ui.muted}
                  />
                </View>
                <PressScale testID="gift-pot-chipin" onPress={chipIn} disabled={busy} style={styles.chipBtn}>
                  <Text style={styles.chipBtnText}>
                    {pot.your_amount != null ? t('gp_update') : t('gp_chip_in')}
                  </Text>
                </PressScale>
              </View>
            </View>
          ) : null}

          {/* Mark sorted */}
          {pot.status !== 'closed' && pot.total_pledged > 0 ? (
            <PressScale testID="gift-pot-close" onPress={markSorted} disabled={busy} style={styles.ghostBtn}>
              <Check color={ui.orangeText} size={16} />
              <Text style={styles.ghostBtnText}>{t('gp_mark_sorted')}</Text>
            </PressScale>
          ) : null}

          <Text style={styles.footnote}>{t('gp_footnote')}</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: ui.line,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  scroll: { padding: 16, paddingBottom: 40 },

  bigIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  startTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 20, textAlign: 'center' },
  startBody: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  cta: { backgroundColor: ui.orange, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, alignItems: 'center' },
  ctaText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  lockNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 14, textAlign: 'center' },

  hero: { alignItems: 'center', backgroundColor: ui.card, borderRadius: 20, borderWidth: 1, borderColor: ui.line, padding: 20, marginBottom: 14 },
  amount: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30 },
  amountOf: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  meta: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 7, marginBottom: 14 },
  bar: { width: '100%', height: 9, borderRadius: 99, backgroundColor: ui.line, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 99, backgroundColor: ui.orange },
  sortedPill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, backgroundColor: ui.mint, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99 },
  sortedText: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },

  sectionLabel: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },
  card: { backgroundColor: ui.card, borderRadius: 16, borderWidth: 1, borderColor: ui.line, padding: 14, marginBottom: 14 },
  emptyRow: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center', paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  rowName: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  rowAmount: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  rowMethod: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11.5, marginTop: 1 },
  viaLink: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  paidToggle: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: ui.line, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  paidToggleOn: { backgroundColor: ui.mintText, borderColor: ui.mintText },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange, paddingVertical: 13, borderRadius: 14, marginBottom: 8 },
  inviteBtnText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  shareMsg: { color: ui.mintText, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, textAlign: 'center', marginBottom: 12 },

  chipLabel: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14, marginBottom: 10 },
  chipRow: { flexDirection: 'row', gap: 10 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: ui.bg, borderRadius: 12, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 12 },
  euro: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 16, marginRight: 4 },
  input: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 16, paddingVertical: 11 },
  chipBtn: { backgroundColor: ui.orange, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chipBtnText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  ghostBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, paddingVertical: 13, borderRadius: 14, marginBottom: 14 },
  ghostBtnText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  footnote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 4 },
});
