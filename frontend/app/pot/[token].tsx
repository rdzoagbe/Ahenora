import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Gift, Check } from 'lucide-react-native';

import { PressScale } from '../../src/components/PressScale';
import { useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, PublicPot, GiftMethod } from '../../src/api';
import { logger } from '../../src/logger';

const METHODS: GiftMethod[] = ['cash', 'transfer', 'gift', 'other'];

/**
 * The outer circle — the ONE screen an invited outsider sees. No account, no
 * household, just this pot, reached by its share link (/pot/<token>). It never
 * touches the store's user; it talks only to the public token endpoints, which
 * return a minimal allow-list. This is also Ahenora's first impression on
 * everyone the organiser invites, so it's built to feel warm and simple.
 */
export default function PublicPotRoute() {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const { token } = useLocalSearchParams<{ token?: string }>();
  const tok = String(token || '');

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pot, setPot] = useState<PublicPot | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<GiftMethod>('cash');

  useEffect(() => setReady(true), []);

  const load = useCallback(async () => {
    if (!tok) { setInvalid(true); setLoading(false); return; }
    setLoading(true);
    try {
      const p = await api.getPublicPot(tok);
      setPot(p);
      if (!amount) setAmount(String(p.per_head || 10));
    } catch (e) {
      logger.warn('public pot load failed', e);
      setInvalid(true);
    } finally {
      setLoading(false);
    }
  }, [tok]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const join = useCallback(async () => {
    if (!name.trim()) return;
    const value = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100) / 100;
    setBusy(true);
    try {
      const updated = await api.joinPublicPot(tok, { name: name.trim(), amount: value, method });
      setPot(updated);
      setJoined(true);
    } catch (e) {
      logger.warn('join pot failed', e);
    } finally {
      setBusy(false);
    }
  }, [name, amount, method, tok]);

  if (!ready) return <SafeAreaView style={styles.safe} edges={['top', 'bottom']} />;

  const target = pot?.target_total ?? (pot ? pot.per_head * Math.max(pot.contributor_count, 2) : 0);
  const pct = pot && target > 0 ? Math.min(1, pot.total_pledged / target) : 0;
  const closed = pot?.status === 'closed';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>
        ) : invalid || !pot ? (
          <View style={styles.center}>
            <View style={styles.bigIcon}><Gift color={ui.orangeText} size={30} /></View>
            <Text style={styles.invalidText}>{t('pub_pot_invalid')}</Text>
          </View>
        ) : joined ? (
          // ---- Thank-you -------------------------------------------------
          <View style={styles.center}>
            <View style={styles.bigIcon}><Check color={ui.mintText} size={32} /></View>
            <Text style={styles.thanksTitle}>{t('pub_pot_thanks_title')}</Text>
            <Text style={styles.thanksBody}>
              {t('pub_pot_thanks_body', { name: pot.organiser_name || t('gp_the_organiser') })}
            </Text>
            <Text style={styles.brandFoot}>{t('pub_pot_what_is')}</Text>
          </View>
        ) : (
          // ---- The invitation + join form --------------------------------
          <>
            <View style={styles.hero}>
              <View style={styles.bigIcon}><Gift color={ui.orangeText} size={30} /></View>
              <Text style={styles.kicker}>{t('pub_pot_invited', { name: pot.organiser_name })}</Text>
              <Text style={styles.heroTitle}>{t('pub_pot_for', { title: pot.title })}</Text>
              {pot.note ? <Text style={styles.note}>“{pot.note}”</Text> : null}
              <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` }]} /></View>
              <Text style={styles.meta}>
                {t('gp_money', { amount: String(pot.total_pledged) })} {t('gp_of', { amount: String(Math.round(target)) })}
                {pot.contributor_count > 0 ? ` · ${pot.contributor_count === 1 ? t('gp_n_in_one') : t('gp_n_in', { n: String(pot.contributor_count) })}` : ''}
              </Text>
            </View>

            {closed ? (
              <Text style={styles.closedNote}>{t('pub_pot_closed')}</Text>
            ) : (
              <View style={styles.card}>
                <Text style={styles.joinTitle}>{t('pub_pot_join_title')}</Text>
                <TextInput
                  testID="pub-pot-name"
                  value={name}
                  onChangeText={setName}
                  placeholder={t('pub_pot_name_ph')}
                  placeholderTextColor={ui.muted}
                  style={styles.input}
                  maxLength={60}
                />
                <Text style={styles.fieldLabel}>{t('pub_pot_amount_label')}</Text>
                <View style={styles.amountWrap}>
                  <Text style={styles.euro}>€</Text>
                  <TextInput
                    testID="pub-pot-amount"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    placeholder={String(pot.per_head || 10)}
                    placeholderTextColor={ui.muted}
                    style={styles.amountInput}
                  />
                </View>
                <Text style={styles.fieldLabel}>{t('pub_pot_method_label')}</Text>
                <View style={styles.methodRow}>
                  {METHODS.map((m) => (
                    <PressScale
                      key={m}
                      testID={`pub-pot-method-${m}`}
                      onPress={() => setMethod(m)}
                      style={[styles.methodChip, method === m && styles.methodChipOn]}
                    >
                      <Text style={[styles.methodText, method === m && styles.methodTextOn]}>
                        {t(`gp_method_${m}`)}
                      </Text>
                    </PressScale>
                  ))}
                </View>
                <PressScale testID="pub-pot-join" onPress={join} disabled={busy || !name.trim()} style={[styles.cta, (busy || !name.trim()) && styles.ctaOff]}>
                  <Text style={styles.ctaText}>{t('pub_pot_join_cta')}</Text>
                </PressScale>
              </View>
            )}

            <Text style={styles.brandFoot}>{t('pub_pot_what_is')}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  scroll: { padding: 20, paddingBottom: 48, maxWidth: 520, width: '100%', alignSelf: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  bigIcon: { width: 66, height: 66, borderRadius: 20, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },

  hero: { alignItems: 'center', backgroundColor: ui.card, borderRadius: 22, borderWidth: 1, borderColor: ui.line, padding: 22, marginBottom: 14 },
  kicker: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase', textAlign: 'center' },
  heroTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, textAlign: 'center', marginTop: 8, letterSpacing: -0.4 },
  note: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 10, lineHeight: 20 },
  bar: { width: '100%', height: 9, borderRadius: 99, backgroundColor: ui.line, overflow: 'hidden', marginTop: 18 },
  barFill: { height: '100%', borderRadius: 99, backgroundColor: ui.orange },
  meta: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 10 },

  card: { backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line, padding: 18 },
  joinTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18, marginBottom: 14 },
  input: { backgroundColor: ui.bg, borderRadius: 12, borderWidth: 1, borderColor: ui.line, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 16, paddingHorizontal: 14, paddingVertical: 13 },
  fieldLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5, marginTop: 16, marginBottom: 8 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: ui.bg, borderRadius: 12, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14 },
  euro: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 17, marginRight: 5 },
  amountInput: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 17, paddingVertical: 13 },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: ui.bg, borderWidth: 1, borderColor: ui.line },
  methodChipOn: { backgroundColor: ui.orangeSoft, borderColor: ui.orange },
  methodText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  methodTextOn: { color: ui.orangeText },
  cta: { marginTop: 20, backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  ctaOff: { opacity: 0.5 },
  ctaText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  closedNote: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  invalidText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
  thanksTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 22, textAlign: 'center' },
  thanksBody: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14.5, textAlign: 'center', marginTop: 10, lineHeight: 21 },
  brandFoot: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center', marginTop: 26, opacity: 0.8 },
});
