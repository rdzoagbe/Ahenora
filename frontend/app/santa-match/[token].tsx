import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Gift } from 'lucide-react-native';

import { useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, SantaMatch } from '../../src/api';
import { logger } from '../../src/logger';

/**
 * The public one-match reveal — the ONE screen an invited outsider sees for
 * Secret Santa (/santa/<token>). No account, no household: it shows only the
 * single name this person drew, the budget and the date, and nothing else about
 * the draw. Talks only to the public token endpoint, which returns that minimal
 * view. Ahenora's warm first impression on everyone the organiser invites.
 */
export default function PublicSantaRoute() {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const { token } = useLocalSearchParams<{ token?: string }>();
  const tok = String(token || '');

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<SantaMatch | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setReady(true), []);

  const load = useCallback(async () => {
    if (!tok) { setInvalid(true); setLoading(false); return; }
    setLoading(true);
    try {
      setMatch(await api.getPublicSantaMatch(tok));
    } catch (e) {
      logger.warn('public santa load failed', e);
      setInvalid(true);
    } finally {
      setLoading(false);
    }
  }, [tok]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  if (!ready) return <SafeAreaView style={styles.safe} edges={['top', 'bottom']} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>
        ) : invalid || !match ? (
          <View style={styles.center}>
            <View style={styles.bigIcon}><Gift color={ui.orangeText} size={30} /></View>
            <Text style={styles.invalidText}>{t('ss_link_invalid')}</Text>
          </View>
        ) : (
          <View style={styles.hero}>
            <View style={styles.bigIcon}><Gift color={ui.orangeText} size={32} /></View>
            {match.draw_title ? <Text style={styles.drawTitle}>{match.draw_title}</Text> : null}
            <Text style={styles.kicker}>{t('ss_your_santa')}</Text>
            <Text style={styles.name}>{match.giftee_name}</Text>
            <View style={styles.chips}>
              {match.budget != null ? (
                <View style={styles.pillOrange}><Text style={styles.pillOrangeText}>{t('ss_budget_chip', { amount: String(match.budget) })}</Text></View>
              ) : null}
              {match.draw_by ? (
                <View style={styles.pillLine}><Text style={styles.pillLineText}>{t('ss_by_chip', { date: match.draw_by })}</Text></View>
              ) : null}
            </View>
            <Text style={styles.secret}>{t('ss_secret')}</Text>
            <Text style={styles.brandFoot}>{t('ss_organised_with')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  scroll: { padding: 20, paddingBottom: 48, maxWidth: 520, width: '100%', alignSelf: 'center', flexGrow: 1, justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  bigIcon: { width: 68, height: 68, borderRadius: 21, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },

  hero: { alignItems: 'center', backgroundColor: ui.card, borderRadius: 24, borderWidth: 1, borderColor: ui.line, padding: 30 },
  drawTitle: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, textAlign: 'center', marginBottom: 4 },
  kicker: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center', marginTop: 6 },
  name: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 42, textAlign: 'center', marginTop: 8, letterSpacing: -0.6 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 18 },
  pillOrange: { backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 7 },
  pillOrangeText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  pillLine: { backgroundColor: ui.soft, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 7 },
  pillLineText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  secret: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 13, backgroundColor: ui.mint, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, marginTop: 24, textAlign: 'center', overflow: 'hidden' },
  brandFoot: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center', marginTop: 22, opacity: 0.8 },

  invalidText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
});
