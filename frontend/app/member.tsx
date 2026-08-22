import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Star } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { ChatThread } from '../src/components/ChatThread';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api, FamilyMember, StarTransaction } from '../src/api';
import { localeFor } from '../src/utils/date';
import { logger } from '../src/logger';

type Kind = 'parent' | 'teen' | 'kid' | 'helper' | 'member';

function kindOf(role: string): Kind {
  const r = (role || '').toLowerCase();
  if (r === 'parent' || r === 'co-parent') return 'parent';
  if (r === 'teen') return 'teen';
  if (r === 'child') return 'kid';
  if (r === 'helper') return 'helper';
  return 'member';
}

/**
 * A single family member's profile, opened from the Family Hub. What it holds
 * depends on who they are:
 *   • a parent / co-parent → the shared grown-ups conversation;
 *   • a teen → a Chat / Stars toggle (their own private thread + their stars);
 *   • a kid → their stars and a quick way to award more;
 *   • a helper or named family member → who they are (no chat: the server
 *     refuses family chat to a helper, so we never offer a door that 403s).
 * The Hub passes the chat `thread` key (the adults thread for parents, the
 * teen's own thread for a teen); an empty key means "no conversation here".
 */
export default function MemberProfile() {
  const ui = useUI();
  const router = useRouter();
  const { t, lang } = useStore();
  const styles = createStyles(ui);
  const params = useLocalSearchParams<{ id?: string; name?: string; role?: string; thread?: string }>();

  const id = String(params.id || '');
  const name = String(params.name || '');
  const role = String(params.role || '');
  const thread = String(params.thread || '');
  const kind = kindOf(role);
  const canChat = Boolean(thread) && (kind === 'parent' || kind === 'teen');
  const showsStars = kind === 'teen' || kind === 'kid';

  const [tab, setTab] = useState<'chat' | 'stars'>(canChat ? 'chat' : 'stars');
  const [member, setMember] = useState<FamilyMember | null>(null);
  const [history, setHistory] = useState<StarTransaction[]>([]);
  const [busy, setBusy] = useState(false);

  const loadStars = useCallback(async () => {
    if (!showsStars || !id) return;
    try {
      const members = await api.familyMembers();
      setMember(members.find((m) => m.member_id === id) || null);
      const h = await api.memberStarHistory(id).catch(() => [] as StarTransaction[]);
      setHistory(h.slice(0, 6));
    } catch (e) {
      logger.warn('member stars load failed', e);
    }
  }, [id, showsStars]);

  useEffect(() => { loadStars(); }, [loadStars]);

  const giveStars = useCallback(async (delta: number) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      await api.adjustMemberStars(id, { delta, reason: t('kids_parent_added_stars') });
      await loadStars();
    } catch (e) {
      logger.warn('give stars failed', e);
    } finally {
      setBusy(false);
    }
  }, [id, busy, loadStars, t]);

  const roleLabel = useMemo(() => {
    if (kind === 'parent') return t('hub_role_coparent');
    if (kind === 'teen') return t('hub_role_teen');
    if (kind === 'kid') return t('hub_role_kid');
    if (kind === 'helper') return t('hub_role_helper');
    return role; // a named family member keeps their own label (Grandma, Nanny…)
  }, [kind, role, t]);

  const badgeTone = kind === 'teen'
    ? { bg: ui.lavender, fg: ui.lavenderText }
    : kind === 'kid'
      ? { bg: ui.mint, fg: ui.mintText }
      : kind === 'parent'
        ? { bg: ui.orangeSoft, fg: ui.orangeText }
        : { bg: ui.soft, fg: ui.muted };

  const stars = member?.stars ?? 0;
  const weekEarned = member?.week_earned ?? 0;
  const weeklyTarget = member?.weekly_target ?? 0;

  const renderStars = () => (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.starCard}>
        <View style={styles.starBig}>
          <Star color={ui.mintText} size={30} fill={ui.mintText} />
          <Text style={styles.starBigNum}>{stars}</Text>
        </View>
        <Text style={styles.starLbl}>
          {weeklyTarget > 0
            ? t('hub_stars_week', { earned: weekEarned, target: weeklyTarget })
            : t('hub_stars_saved')}
        </Text>
      </View>

      <Text style={styles.sec}>{t('hub_give_stars')}</Text>
      <View style={styles.giveRow}>
        {[1, 3, 5].map((n) => (
          <PressScale
            key={n}
            testID={`member-give-${n}`}
            disabled={busy}
            onPress={() => giveStars(n)}
            style={[styles.giveBtn, busy && { opacity: 0.5 }]}
          >
            <Star color="#fff" size={15} fill="#fff" />
            <Text style={styles.giveBtnText}>+{n}</Text>
          </PressScale>
        ))}
      </View>

      {history.length > 0 ? (
        <>
          <Text style={styles.sec}>{t('hub_recent_stars')}</Text>
          {history.map((h) => (
            <View key={h.transaction_id} style={styles.histRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.histReason} numberOfLines={1}>{h.reason || t('hub_stars_adjustment')}</Text>
                {h.created_at ? (
                  <Text style={styles.histDate}>
                    {new Date(h.created_at).toLocaleDateString(localeFor(lang), { month: 'short', day: 'numeric' })}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.histDelta, { color: h.delta >= 0 ? ui.mintText : ui.orangeText }]}>
                {h.delta >= 0 ? '+' : ''}{h.delta}★
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {kind === 'kid' ? (
        <Text style={styles.footNote}>{t('hub_kid_tools_hint')}</Text>
      ) : null}
    </ScrollView>
  );

  const renderInfo = () => (
    <ScrollView contentContainerStyle={styles.body}>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{t('hub_role_on_team', { role: roleLabel })}</Text>
        <Text style={styles.infoBody}>
          {kind === 'helper' ? t('hub_helper_access') : t('hub_member_access')}
        </Text>
      </View>
      {kind === 'helper' ? (
        <Text style={styles.footNote}>{t('hub_helper_no_chat')}</Text>
      ) : null}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <PressScale testID="member-back" onPress={() => router.back()} style={styles.backBtn} accessibilityLabel={t('back')}>
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <View style={styles.headMid}>
          <Text style={styles.headName} numberOfLines={1}>{name}</Text>
          <View style={[styles.headBadge, { backgroundColor: badgeTone.bg }]}>
            <Text style={[styles.headBadgeText, { color: badgeTone.fg }]}>{roleLabel}</Text>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      {/* A teen gets both worlds behind a toggle; everyone else has one view. */}
      {kind === 'teen' && canChat ? (
        <View style={styles.segt}>
          <PressScale testID="member-tab-chat" onPress={() => setTab('chat')} style={[styles.segBtn, tab === 'chat' && styles.segOn]}>
            <Text style={[styles.segText, tab === 'chat' && styles.segTextOn]}>{t('hub_tab_chat')}</Text>
          </PressScale>
          <PressScale testID="member-tab-stars" onPress={() => setTab('stars')} style={[styles.segBtn, tab === 'stars' && styles.segOn]}>
            <Text style={[styles.segText, tab === 'stars' && styles.segTextOn]}>{t('hub_tab_stars')}</Text>
          </PressScale>
        </View>
      ) : null}

      {canChat && (kind === 'parent' || (kind === 'teen' && tab === 'chat')) ? (
        <View style={{ flex: 1 }}>
          <ChatThread
            load={() => api.chatGet(thread)}
            send={(text) => api.chatSend(thread, text)}
            markRead={() => api.chatRead(thread)}
            emptyHint={kind === 'parent' ? t('chat_empty_adults') : t('chat_empty_teen')}
          />
        </View>
      ) : showsStars && (kind === 'kid' || tab === 'stars') ? (
        renderStars()
      ) : (
        renderInfo()
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
  headMid: { flex: 1, alignItems: 'center', gap: 4 },
  headName: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text, maxWidth: '90%' },
  headBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  headBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  segt: {
    flexDirection: 'row', gap: 4, margin: 14, padding: 3,
    backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 12,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segOn: { backgroundColor: ui.card },
  segText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.muted },
  segTextOn: { color: ui.text },

  body: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },

  starCard: {
    alignItems: 'center', backgroundColor: ui.mint, borderRadius: 20, paddingVertical: 22,
    borderWidth: 1, borderColor: ui.line, marginBottom: 18,
  },
  starBig: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  starBigNum: { fontFamily: 'Inter_800ExtraBold', fontSize: 40, color: ui.mintText },
  starLbl: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: ui.mintText, marginTop: 6, opacity: 0.9 },

  sec: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: ui.muted, marginBottom: 10, marginTop: 4 },
  giveRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  giveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 13,
  },
  giveBtnText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#fff' },

  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ui.card,
    borderWidth: 1, borderColor: ui.line, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 8,
  },
  histReason: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: ui.text },
  histDate: { fontFamily: 'Inter_400Regular', fontSize: 12, color: ui.muted, marginTop: 2 },
  histDelta: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  infoCard: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 18, padding: 18 },
  infoTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: ui.text, marginBottom: 6 },
  infoBody: { fontFamily: 'Inter_400Regular', fontSize: 14, color: ui.muted, lineHeight: 20 },
  footNote: {
    fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.muted, lineHeight: 18,
    backgroundColor: ui.soft, borderRadius: 12, padding: 12, marginTop: 16,
  },
});
