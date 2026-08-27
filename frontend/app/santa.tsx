import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Gift, Check, Shuffle, Send, Trash2, X, Plus, Lock, MessageCircle } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { KeyboardAwareScrollView } from '../src/components/KeyboardAwareScrollView';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { usePremiumGate } from '../src/components/PremiumGate';
import { api, SantaDraw, SantaMatch, FamilyMember } from '../src/api';
import { logger } from '../src/logger';

/**
 * Secret Santa — a name-draw gift exchange. Build the list, shuffle, send.
 * Building and shuffling are free; SENDING is the Family gate. The draw is
 * secret even from the organiser: the assignment map never reaches this screen,
 * and everyone (organiser included) reveals only their own match.
 *
 * Params: drawId (open an existing draw) OR none (build a new one).
 */
type Part = { name: string; member_id?: string; source: 'member' | 'link'; contact?: string };

export default function SantaRoute() {
  const ui = useUI();
  const router = useRouter();
  const { t } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const params = useLocalSearchParams<{ drawId?: string }>();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draw, setDraw] = useState<SantaDraw | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = isLocked('secret_santa');

  // Building state (used while status is draft, or when editing a matched draw).
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState('');
  const [drawBy, setDrawBy] = useState('');
  const [parts, setParts] = useState<Part[]>([]);
  const [pairs, setPairs] = useState<[string, string][]>([]);
  const [pairPick, setPairPick] = useState<string | null>(null);
  const [addName, setAddName] = useState('');

  // The reveal (a member seeing their own match).
  const [reveal, setReveal] = useState<SantaMatch | null>(null);
  const [copiedFor, setCopiedFor] = useState<string | null>(null);

  useEffect(() => setReady(true), []);

  const seedBuildFrom = useCallback((d: SantaDraw) => {
    setTitle(d.title || '');
    setBudget(d.budget != null ? String(d.budget) : '');
    setDrawBy(d.draw_by || '');
    setParts(d.participants.map((p) => ({ name: p.name, member_id: p.member_id || undefined, source: p.source, contact: p.contact || undefined })));
    setPairs((d.exclusions || []).map((e) => [e[0], e[1]] as [string, string]));
    setPairPick(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mem = await api.familyMembers().catch(() => [] as FamilyMember[]);
      setMembers(mem);
      if (params.drawId) {
        const d = await api.getSantaDraw(String(params.drawId));
        setDraw(d);
        if (d.status === 'draft') seedBuildFrom(d);
      } else {
        setDraw(null);
        // A fresh draw starts pre-filled with the household members, since a
        // family exchange almost always includes everyone at home.
        setParts(mem.filter((m) => m.role !== 'Child' || m.has_account).map((m) => ({ name: m.name, member_id: m.member_id, source: 'member' as const })));
      }
    } catch (e) {
      logger.warn('santa load failed', e);
      setDraw(null);
    } finally {
      setLoading(false);
    }
  }, [params.drawId, seedBuildFrom]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const isBuilding = !draw || draw.status === 'draft' || editing;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed'));

  const num = (s: string) => {
    const v = parseFloat(s.replace(',', '.'));
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
  };

  const hasPart = (name: string) => parts.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

  const addMember = (m: FamilyMember) => {
    if (hasPart(m.name)) return;
    setParts((p) => [...p, { name: m.name, member_id: m.member_id, source: 'member' }]);
  };
  const addOutsider = () => {
    const n = addName.trim();
    if (!n || hasPart(n)) { setAddName(''); return; }
    setParts((p) => [...p, { name: n, source: 'link' }]);
    setAddName('');
  };
  const removePart = (name: string) => {
    setParts((p) => p.filter((x) => x.name !== name));
    setPairs((ps) => ps.filter(([a, b]) => a !== name && b !== name));
    if (pairPick === name) setPairPick(null);
  };
  const setPartContact = (name: string, contact: string) =>
    setParts((p) => p.map((x) => (x.name === name ? { ...x, contact } : x)));

  const isEmail = (c: string) => c.includes('@');

  // Send a person their link from the ORGANISER's own device — no provider, no
  // cost. An email opens the mail app (mailto:), a number opens the messaging
  // app (sms:); both come pre-filled. Falls back to the share sheet on web.
  const contactPerson = (contact: string, link: string) => {
    const body = t('ss_text_body', { link });
    let url: string;
    if (isEmail(contact)) {
      url = `mailto:${encodeURIComponent(contact.trim())}?subject=${encodeURIComponent(t('ss_email_subject'))}&body=${encodeURIComponent(body)}`;
    } else {
      const num = contact.replace(/[^0-9+]/g, '');
      const sep = Platform.OS === 'ios' ? '&' : '?';
      url = `sms:${num}${sep}body=${encodeURIComponent(body)}`;
    }
    Linking.openURL(url).catch(() => { Share.share({ message: body }).catch(() => undefined); });
  };
  const tapPair = (name: string) => {
    if (pairPick === null) { setPairPick(name); return; }
    if (pairPick === name) { setPairPick(null); return; }
    const exists = pairs.some(([a, b]) => (a === pairPick && b === name) || (a === name && b === pairPick));
    if (!exists) setPairs((ps) => [...ps, [pairPick, name]]);
    setPairPick(null);
  };
  const removePair = (i: number) => setPairs((ps) => ps.filter((_, idx) => idx !== i));

  const santaLink = (token: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}/app/santa-match/${token}`;
    }
    return `https://ahenora.com/app/santa-match/${token}`;
  };

  const shuffle = useCallback(async () => {
    setError(null);
    if (parts.length < 2) { setError(t('ss_need_two')); return; }
    const participants = parts.map((p) => ({ name: p.name, member_id: p.member_id, contact: p.contact }));
    const payload = {
      title: title.trim(),
      budget: num(budget) ?? null,
      draw_by: drawBy.trim() || null,
      participants,
      exclusions: pairs,
    };
    setBusy(true);
    try {
      let d = draw;
      if (!d) {
        d = await api.createSantaDraw(payload);
      } else {
        d = await api.editSantaDraw(d.draw_id, payload);
      }
      const shuffled = await api.shuffleSantaDraw(d.draw_id);
      setDraw(shuffled);
      setEditing(false);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setError(msg || 'Could not draw the names.');
      logger.warn('santa shuffle failed', e);
    } finally {
      setBusy(false);
    }
  }, [parts, title, budget, drawBy, pairs, draw, t]);

  const send = useCallback(async () => {
    if (!draw) return;
    if (locked) { promptUpgrade('secret_santa'); return; }
    setBusy(true);
    try {
      setDraw(await api.sendSantaDraw(draw.draw_id));
    } catch (e) {
      if ((e as { status?: number })?.status === 402) promptUpgrade('secret_santa');
      else logger.warn('santa send failed', e);
    } finally {
      setBusy(false);
    }
  }, [draw, locked, promptUpgrade]);

  const revealMine = useCallback(async () => {
    if (!draw) return;
    setBusy(true);
    try { setReveal(await api.getMySantaMatch(draw.draw_id)); }
    catch (e) { logger.warn('santa reveal failed', e); }
    finally { setBusy(false); }
  }, [draw]);

  const copyLink = useCallback(async (token: string, name: string) => {
    const url = santaLink(token);
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopiedFor(name);
      } else {
        await Share.share({ message: url, url });
      }
    } catch (e) { logger.warn('santa copy failed', e); }
  }, []);

  const editList = () => { if (draw) seedBuildFrom(draw); setEditing(true); };

  const removeDraw = useCallback(async () => {
    if (!draw) { goBack(); return; }
    setBusy(true);
    try { await api.deleteSantaDraw(draw.draw_id); goBack(); }
    catch (e) { logger.warn('santa delete failed', e); }
    finally { setBusy(false); }
  }, [draw]);

  if (!ready) return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']} />;

  const availableMembers = members.filter((m) => !hasPart(m.name) && (m.role !== 'Child' || m.has_account));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale testID="santa-back" onPress={goBack} style={styles.iconBtn} accessibilityLabel={t('back')}>
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <Text style={styles.headTitle} numberOfLines={1}>{t('ss_title')}</Text>
        {draw && draw.status !== 'sent' ? (
          <PressScale testID="santa-delete" onPress={removeDraw} style={styles.iconBtn} accessibilityLabel={t('ss_delete')}>
            <Trash2 color={ui.muted} size={19} />
          </PressScale>
        ) : <View style={{ width: 36 }} />}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>
      ) : isBuilding ? (
        // ---- Build the list ------------------------------------------------
        // Keyboard-aware: any field the organiser types into (a name, a phone,
        // an email) is scrolled clear of the keyboard instead of hiding under it.
        <KeyboardAwareScrollView contentContainerStyle={styles.scroll}>
          {!draw ? (
            <View style={styles.introHead}>
              <View style={styles.bigIcon}><Gift color={ui.orangeText} size={28} /></View>
              <Text style={styles.introTitle}>{t('ss_start_title')}</Text>
              <Text style={styles.introBody}>{t('ss_start_body')}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>{t('ss_name_label')}</Text>
          <View style={styles.field}><TextInput testID="santa-title" value={title} onChangeText={setTitle} placeholder={t('ss_name_ph')} placeholderTextColor={ui.muted} style={styles.fieldInput} /></View>

          <View style={styles.two}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t('ss_budget')}</Text>
              <View style={styles.fieldMoney}><Text style={styles.euro}>€</Text><TextInput testID="santa-budget" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" placeholder="—" placeholderTextColor={ui.muted} style={styles.fieldInput} /></View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t('ss_draw_by')}</Text>
              <View style={styles.field}><TextInput testID="santa-drawby" value={drawBy} onChangeText={setDrawBy} placeholder={t('ss_draw_by_ph')} placeholderTextColor={ui.muted} style={styles.fieldInput} /></View>
            </View>
          </View>

          <Text style={styles.label}>{t('ss_whos_in')} · {parts.length}</Text>
          <View style={styles.card}>
            {parts.length === 0 ? (
              <Text style={styles.emptyRow}>—</Text>
            ) : parts.map((p) => {
              const picking = pairPick === p.name;
              return (
                <View key={p.name} style={styles.prow}>
                  <PressScale
                    onPress={() => tapPair(p.name)}
                    style={[styles.avatar, picking && styles.avatarPick]}
                    accessibilityLabel={t('ss_keep_apart')}
                  >
                    <Text style={[styles.avatarText, picking && { color: '#fff' }]}>{(p.name || '?').slice(0, 1).toUpperCase()}</Text>
                  </PressScale>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                    {p.source === 'member' ? (
                      <Text style={styles.rowMeta}>{t('ss_in_household')}</Text>
                    ) : (
                      <View style={styles.phoneWrap}>
                        <MessageCircle color={ui.muted} size={12} />
                        <TextInput
                          testID={`santa-contact-${p.name}`}
                          value={p.contact || ''}
                          onChangeText={(v) => setPartContact(p.name, v)}
                          placeholder={t('ss_contact_ph')}
                          placeholderTextColor={ui.muted}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          style={styles.phoneInput}
                        />
                      </View>
                    )}
                  </View>
                  <PressScale onPress={() => removePart(p.name)} style={styles.removeBtn} hitSlop={10} accessibilityLabel="Remove"><X color={ui.muted} size={18} /></PressScale>
                </View>
              );
            })}
          </View>

          {/* Add from household */}
          {availableMembers.length > 0 ? (
            <View style={styles.chipsWrap}>
              {availableMembers.map((m) => (
                <PressScale key={m.member_id} testID={`santa-add-${m.member_id}`} onPress={() => addMember(m)} style={styles.addChip}>
                  <Plus color={ui.orangeText} size={13} /><Text style={styles.addChipText}>{m.name}</Text>
                </PressScale>
              ))}
            </View>
          ) : null}

          {/* Add an outsider by name */}
          <View style={styles.addRow}>
            <View style={[styles.field, { flex: 1 }]}><TextInput testID="santa-add-name" value={addName} onChangeText={setAddName} onSubmitEditing={addOutsider} placeholder={t('ss_add_person_ph')} placeholderTextColor={ui.muted} style={styles.fieldInput} returnKeyType="done" /></View>
            <PressScale testID="santa-add-outsider" onPress={addOutsider} style={styles.addBtn}><Text style={styles.addBtnText}>{t('ss_add_person')}</Text></PressScale>
          </View>

          {/* Keep-apart pairs */}
          {pairs.length > 0 || pairPick ? (
            <View style={styles.keepApart}>
              <Text style={styles.keepApartTitle}>{t('ss_keep_apart')}</Text>
              {pairPick ? <Text style={styles.keepApartHint}>{t('ss_pick_second', { name: pairPick })}</Text> : null}
              {pairs.map((pr, i) => (
                <View key={`${pr[0]}-${pr[1]}`} style={styles.pairRow}>
                  <Text style={styles.pairText}>{pr[0]} ⇎ {pr[1]}</Text>
                  <PressScale onPress={() => removePair(i)} style={styles.removeBtn}><X color={ui.muted} size={15} /></PressScale>
                </View>
              ))}
              <Text style={styles.keepApartHint}>{t('ss_keep_apart_hint')}</Text>
            </View>
          ) : (
            <Text style={styles.keepApartHint}>{t('ss_keep_apart_hint')}</Text>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <PressScale testID="santa-shuffle" onPress={shuffle} disabled={busy} style={styles.cta}>
            <Shuffle color="#fff" size={17} /><Text style={styles.ctaText}>{t('ss_shuffle')}</Text>
          </PressScale>
          {locked ? <Text style={styles.lockNote}>{t('ss_family_note')}</Text> : null}
          <View style={{ height: 24 }} />
        </KeyboardAwareScrollView>
      ) : draw && draw.status === 'matched' ? (
        // ---- Matched: ready to send ---------------------------------------
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.matchedHero}>
            <View style={styles.bigIcon}><Gift color={ui.orangeText} size={30} /></View>
            <Text style={styles.matchedTitle}>{t('ss_matched')}</Text>
            <View style={styles.checkList}>
              <View style={styles.checkItem}><View style={styles.tick}><Check color={ui.mintText} size={12} /></View><Text style={styles.checkText}>{draw.participant_count === 1 ? t('ss_one_person') : t('ss_matched_all', { n: String(draw.participant_count) })}</Text></View>
              <View style={styles.checkItem}><View style={styles.tick}><Check color={ui.mintText} size={12} /></View><Text style={styles.checkText}>{t('ss_matched_self')}</Text></View>
              {draw.exclusions.length > 0 ? (
                <View style={styles.checkItem}><View style={styles.tick}><Check color={ui.mintText} size={12} /></View><Text style={styles.checkText}>{t('ss_matched_apart')}</Text></View>
              ) : null}
            </View>
          </View>

          <PressScale testID="santa-send" onPress={send} disabled={busy} style={styles.cta}>
            {locked ? <Lock color="#fff" size={16} /> : <Send color="#fff" size={16} />}
            <Text style={styles.ctaText}>{t('ss_send')}</Text>
          </PressScale>
          <PressScale testID="santa-reshuffle" onPress={shuffle} disabled={busy} style={styles.ghostBtn}>
            <Shuffle color={ui.orangeText} size={16} /><Text style={styles.ghostBtnText}>{t('ss_reshuffle')}</Text>
          </PressScale>
          <PressScale testID="santa-editlist" onPress={editList} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>{t('ss_edit_list')}</Text>
          </PressScale>
          <Text style={styles.blindNote}>{t('ss_blind_note')}</Text>
          {locked ? <Text style={styles.lockNote}>{t('ss_family_note')}</Text> : null}
        </ScrollView>
      ) : draw ? (
        // ---- Sent: track delivery + reveal --------------------------------
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.sentHero}>
            <Text style={styles.sentBig}>{draw.opened_count}<Text style={styles.sentOf}>/{draw.participant_count}</Text></Text>
            <Text style={styles.sentLabel}>{t('ss_status_opened').toLowerCase()}</Text>
          </View>

          {draw.viewer_can_reveal ? (
            <PressScale testID="santa-reveal" onPress={revealMine} disabled={busy} style={styles.cta}>
              <Gift color="#fff" size={16} /><Text style={styles.ctaText}>{t('ss_reveal_mine')}</Text>
            </PressScale>
          ) : null}

          <Text style={styles.label}>{t('ss_delivery')}</Text>
          <View style={styles.card}>
            {draw.participants.map((p) => (
              <View key={p.pid} style={styles.prow}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(p.name || '?').slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowMeta}>{p.is_member ? t('ss_in_household') : t('ss_by_link')}</Text>
                </View>
                {p.opened ? (
                  <View style={styles.pillMint}><Text style={styles.pillMintText}>{t('ss_status_opened')}</Text></View>
                ) : p.token && p.contact ? (
                  <PressScale onPress={() => contactPerson(p.contact as string, santaLink(p.token as string))} style={styles.pillOrange}>
                    <MessageCircle color={ui.orangeText} size={12} />
                    <Text style={styles.pillOrangeText}>{p.contact.includes('@') ? t('ss_email') : t('ss_text')}</Text>
                  </PressScale>
                ) : p.token ? (
                  <PressScale onPress={() => copyLink(p.token as string, p.name)} style={styles.pillOrange}>
                    <Text style={styles.pillOrangeText}>{copiedFor === p.name ? '✓' : t('ss_copy_link')}</Text>
                  </PressScale>
                ) : (
                  <View style={styles.pillLine}><Text style={styles.pillLineText}>{t('ss_status_waiting')}</Text></View>
                )}
              </View>
            ))}
          </View>
          {copiedFor ? <Text style={styles.copiedMsg}>{t('ss_link_copied', { name: copiedFor })}</Text> : null}
          <Text style={styles.footnote}>{t('ss_footnote')}</Text>
        </ScrollView>
      ) : null}

      {/* Reveal modal */}
      <Modal visible={!!reveal} transparent animationType="fade" onRequestClose={() => setReveal(null)}>
        <View style={styles.revealBackdrop}>
          <View style={styles.revealCard}>
            <PressScale onPress={() => setReveal(null)} style={styles.revealClose}><X color={ui.muted} size={20} /></PressScale>
            <View style={styles.bigIcon}><Gift color={ui.orangeText} size={30} /></View>
            <Text style={styles.revealKicker}>{t('ss_your_santa')}</Text>
            <Text style={styles.revealName}>{reveal?.giftee_name}</Text>
            <View style={styles.revealChips}>
              {reveal?.budget != null ? <View style={styles.pillOrange}><Text style={styles.pillOrangeText}>{t('ss_budget_chip', { amount: String(reveal.budget) })}</Text></View> : null}
              {reveal?.draw_by ? <View style={styles.pillLine}><Text style={styles.pillLineText}>{t('ss_by_chip', { date: reveal.draw_by })}</Text></View> : null}
            </View>
            <Text style={styles.revealSecret}>{t('ss_secret')}</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  scroll: { padding: 16, paddingBottom: 120 },

  introHead: { alignItems: 'center', marginBottom: 10 },
  bigIcon: { width: 60, height: 60, borderRadius: 19, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  introTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, textAlign: 'center' },
  introBody: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 7, marginBottom: 6 },

  label: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 7, marginLeft: 2 },
  field: { backgroundColor: ui.card, borderRadius: 12, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  fieldMoney: { backgroundColor: ui.card, borderRadius: 12, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  fieldInput: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15, paddingVertical: 13 },
  euro: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 15, marginRight: 4 },
  two: { flexDirection: 'row', gap: 10 },

  card: { backgroundColor: ui.card, borderRadius: 16, borderWidth: 1, borderColor: ui.line, padding: 6, paddingHorizontal: 12 },
  emptyRow: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center', paddingVertical: 12 },
  prow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  avatarPick: { backgroundColor: ui.orangeDeep, borderWidth: 2, borderColor: ui.orangeText },
  avatarText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  rowName: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  rowMeta: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 11.5, marginTop: 1 },
  phoneWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  phoneInput: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, paddingVertical: 2 },
  removeBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  addChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.line, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 99 },
  addChipText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },

  addRow: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'stretch' },
  addBtn: { backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },

  keepApart: { marginTop: 14, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 14, padding: 13 },
  keepApartTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 13, marginBottom: 8 },
  keepApartHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 10, lineHeight: 17, marginLeft: 2 },
  pairRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5 },
  pairText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 13.5 },

  errorText: { color: ui.danger, fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'center', marginTop: 14 },

  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: ui.orange, paddingVertical: 15, borderRadius: 14, marginTop: 18 },
  ctaText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  lockNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 12, textAlign: 'center' },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, paddingVertical: 13, borderRadius: 14, marginTop: 9 },
  ghostBtnText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  matchedHero: { alignItems: 'center', backgroundColor: ui.card, borderRadius: 20, borderWidth: 1, borderColor: ui.line, padding: 22, marginTop: 4 },
  matchedTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 21, marginBottom: 4 },
  checkList: { marginTop: 12, gap: 9, alignSelf: 'stretch' },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  tick: { width: 19, height: 19, borderRadius: 10, backgroundColor: ui.mint, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  blindNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginTop: 16 },

  sentHero: { alignItems: 'center', backgroundColor: ui.card, borderRadius: 20, borderWidth: 1, borderColor: ui.line, paddingVertical: 22, marginTop: 4 },
  sentBig: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 40, lineHeight: 44 },
  sentOf: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 22 },
  sentLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, textTransform: 'capitalize', marginTop: 2 },

  pillMint: { backgroundColor: ui.mint, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillMintText: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  pillOrange: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5 },
  pillOrangeText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 11.5 },
  pillLine: { backgroundColor: ui.soft, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillLineText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 11 },
  copiedMsg: { color: ui.mintText, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, textAlign: 'center', marginTop: 10 },
  footnote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 16 },

  revealBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  revealCard: { width: '100%', maxWidth: 360, backgroundColor: ui.bg, borderRadius: 24, padding: 28, alignItems: 'center' },
  revealClose: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  revealKicker: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  revealName: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 38, marginTop: 8, textAlign: 'center' },
  revealChips: { flexDirection: 'row', gap: 8, marginTop: 16 },
  revealSecret: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12.5, backgroundColor: ui.mint, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 99, marginTop: 22, textAlign: 'center', overflow: 'hidden' },
});
