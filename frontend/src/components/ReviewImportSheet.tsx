import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X, MapPin, CalendarDays } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, EventCandidate, FamilyMember } from '../api';
import { logger } from '../logger';
import { localeFor, toLocalTimeInput } from '../utils/date';

/**
 * "Here's what we found. What do you want to keep?"
 *
 * Sync used to write every event straight into the family's calendar. Import a
 * work diary and forty stand-ups land next to the school run, with no way back
 * but deleting them one at a time — so people stopped syncing.
 *
 * Everything arrives here first. Two decisions, in the order a person actually
 * makes them: which of these belong to the household, and then — once, about
 * the whole batch — who else needs to know. Asking about sharing per event
 * turns a thirty-second job into thirty decisions.
 *
 * Built from the same Kit primitives as the rest of the app on purpose: this
 * is a new step, not a new visual language.
 */
export function ReviewImportSheet({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone?: (created: number) => void;
}) {
  const ui = useUI();
  const { t, user, lang } = useStore();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [items, setItems] = useState<EventCandidate[]>([]);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [step, setStep] = useState<'pick' | 'share'>('pick');
  const [shareWith, setShareWith] = useState<string | null>(null);
  const [shareAll, setShareAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // No setLoading(true) here: the component mounts with loading already true
  // and is remounted for each review, so raising it again would only be a
  // synchronous setState inside the effect that calls this.
  const load = useCallback(async () => {
    try {
      const out = await api.listEventCandidates();
      setItems(out.candidates);
      // Everything starts kept. The common case is "yes, these are mine" —
      // starting from nothing selected would make the honest answer the most
      // work, and people would tap Keep all without reading.
      const initial: Record<string, boolean> = {};
      out.candidates.forEach((c) => { initial[c.candidate_id] = true; });
      setKeep(initial);
    } catch (e) {
      logger.warn('candidates load failed', e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Mounted only while it is open (see the calendar screen), so there is
  // nothing to reset — a fresh open is a fresh component. That is also why
  // this runs once rather than watching `visible`: resetting state from an
  // effect is the cascading-render pattern lint rightly objects to, and
  // remounting says the same thing without the machinery.
  useEffect(() => {
    load();
    let cancelled = false;
    api.familyMembers()
      .then((m) => { if (!cancelled) setMembers(m.filter((x) => x.name !== user?.name)); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, [load, user?.name]);

  // The sheet is source-agnostic by design; the copy was not. It said "events
  // from your calendar" over a list that came from photographing a school
  // letter — a small lie, and the kind that makes someone distrust the rest.
  const fromScanOnly =
    items.length > 0 && items.every((c) => c.source_kind === 'document_scan');

  const keptIds = items.filter((c) => keep[c.candidate_id]).map((c) => c.candidate_id);
  const droppedIds = items.filter((c) => !keep[c.candidate_id]).map((c) => c.candidate_id);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await api.decideEventCandidates({
        keep: keptIds,
        drop: droppedIds,
        shared: shareAll,
        assignee: shareWith,
      });
      onDone?.(out.created);
      onClose();
    } catch (e) {
      logger.warn('candidate decision failed', e);
    } finally {
      setBusy(false);
    }
  };

  // "Mon 14 Sep · 18:30", not "2026-09-14 · 18:30". The first version reused
  // toLocalDateInput, which exists to fill a date INPUT and so returns the
  // machine form — correct there, wrong the moment a person reads it. Seeing
  // it on screen is what made that obvious; it looked fine in the source.
  //
  // The weekday earns its place here: deciding whether an event belongs to the
  // household is mostly "is that a school night", which a number cannot answer.
  const locale = localeFor(lang);
  const when = (c: EventCandidate) => {
    if (!c.due_date) return '';
    const at = new Date(c.due_date);
    if (Number.isNaN(at.getTime())) return '';
    const day = at.toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    return `${day} · ${toLocalTimeInput(c.due_date)}`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) + 76 }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.title}>
              {step === 'pick' ? t('review_title') : t('review_share_title')}
            </Text>
            <PressScale testID="review-close" onPress={onClose} style={styles.iconBtn}>
              <X color={ui.text} size={18} />
            </PressScale>
          </View>
          {step === 'pick' && items.length > 3 ? (
            <PressScale
              testID="review-toggle-all"
              onPress={() => {
                const next: Record<string, boolean> = {};
                const turningOn = keptIds.length === 0;
                items.forEach((c) => { next[c.candidate_id] = turningOn; });
                setKeep(next);
              }}
              style={styles.bulkBtn}
            >
              <Text style={styles.bulkText}>
                {keptIds.length === 0 ? t('review_keep_all') : t('review_drop_all')}
              </Text>
            </PressScale>
          ) : null}
          <Text style={styles.sub}>
            {step === 'pick'
              ? t(fromScanOnly ? 'review_sub_scan' : 'review_sub', { n: items.length })
              : t('review_share_sub', { n: keptIds.length })}
          </Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner}>
            {loading ? (
              <Text style={styles.empty}>{t('review_loading')}</Text>
            ) : items.length === 0 ? (
              <Text style={styles.empty}>{t('review_empty')}</Text>
            ) : step === 'pick' ? (
              items.map((c) => {
                const on = !!keep[c.candidate_id];
                return (
                  <PressScale
                    key={c.candidate_id}
                    testID={`review-item-${c.candidate_id}`}
                    onPress={() => setKeep((k) => ({ ...k, [c.candidate_id]: !on }))}
                    style={[styles.item, !on && styles.itemOff]}
                  >
                    <View style={[styles.tick, on && styles.tickOn]}>
                      {on ? <Check color="#fff" size={13} /> : null}
                    </View>
                    <View style={styles.itemBody}>
                      <Text style={[styles.itemTitle, !on && styles.textOff]} numberOfLines={2}>
                        {c.title}
                      </Text>
                      {c.due_date ? (
                        <View style={styles.metaRow}>
                          <CalendarDays color={ui.muted} size={11} />
                          <Text style={styles.meta}>{when(c)}</Text>
                        </View>
                      ) : null}
                      {c.location ? (
                        <View style={styles.metaRow}>
                          <MapPin color={ui.muted} size={11} />
                          <Text style={styles.meta} numberOfLines={1}>{c.location}</Text>
                        </View>
                      ) : null}
                    </View>
                  </PressScale>
                );
              })
            ) : (
              <>
                <PressScale
                  testID="review-share-all"
                  onPress={() => { setShareAll(true); setShareWith(null); }}
                  style={[styles.item, shareAll && !shareWith && styles.itemPicked]}
                >
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle}>{t('review_share_family')}</Text>
                    <Text style={styles.meta}>{t('review_share_family_sub')}</Text>
                  </View>
                </PressScale>
                {members.map((m) => (
                  <PressScale
                    key={m.member_id}
                    testID={`review-share-${m.member_id}`}
                    onPress={() => { setShareWith(m.name); setShareAll(true); }}
                    style={[styles.item, shareWith === m.name && styles.itemPicked]}
                  >
                    <View style={styles.itemBody}>
                      <Text style={styles.itemTitle}>{m.name}</Text>
                      <Text style={styles.meta}>{t('review_share_person_sub')}</Text>
                    </View>
                  </PressScale>
                ))}
                <PressScale
                  testID="review-share-none"
                  onPress={() => { setShareAll(false); setShareWith(null); }}
                  style={[styles.item, !shareAll && styles.itemPicked]}
                >
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle}>{t('review_share_private')}</Text>
                    <Text style={styles.meta}>{t('review_share_private_sub')}</Text>
                  </View>
                </PressScale>
              </>
            )}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            {step === 'pick' ? (
              <PressScale
                testID="review-continue"
                onPress={() => (keptIds.length ? setStep('share') : submit())}
                disabled={busy || loading}
                style={[styles.cta, (busy || loading) && styles.ctaOff]}
              >
                <Text style={styles.ctaText}>
                  {keptIds.length
                    ? t('review_keep_n', { n: keptIds.length })
                    : t('review_keep_none')}
                </Text>
              </PressScale>
            ) : (
              <PressScale
                testID="review-finish"
                onPress={submit}
                disabled={busy}
                style={[styles.cta, busy && styles.ctaOff]}
              >
                <Text style={styles.ctaText}>{t('review_add')}</Text>
              </PressScale>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: ui.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 18, paddingTop: 10, maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: ui.muted, opacity: 0.5, marginBottom: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 21, letterSpacing: -0.4 },
  iconBtn: { padding: 6, borderRadius: 999, backgroundColor: ui.soft },
  bulkBtn: {
    alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1, borderColor: ui.line,
    backgroundColor: ui.soft, marginTop: 8,
  },
  bulkText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  sub: { color: ui.muted, fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4, marginBottom: 10 },
  scroll: { flexGrow: 0 },
  scrollInner: { paddingBottom: 8, gap: 8 },
  empty: { color: ui.muted, fontFamily: 'Inter_400Regular', fontSize: 14, paddingVertical: 24, textAlign: 'center' },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
  },
  itemOff: { opacity: 0.55 },
  itemPicked: { borderColor: ui.orange },
  tick: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1.5,
    borderColor: ui.line, alignItems: 'center', justifyContent: 'center',
  },
  tickOn: { backgroundColor: ui.orangeDeep, borderColor: ui.orangeDeep },
  itemBody: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  textOff: { textDecorationLine: 'line-through' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { color: ui.muted, fontFamily: 'Inter_400Regular', fontSize: 12, flexShrink: 1 },
  footer: {
    position: 'absolute', left: 18, right: 18, bottom: 0,
    backgroundColor: ui.card, paddingTop: 10,
  },
  cta: {
    borderRadius: 16, paddingVertical: 14, alignItems: 'center',
    backgroundColor: ui.orangeDeep,
  },
  ctaOff: { opacity: 0.6 },
  ctaText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 },
});
