import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Calendar as CalendarIcon, ChevronLeft, FileText, Lock, Search as SearchIcon,
  ShoppingCart, StickyNote, UtensilsCrossed, X,
} from 'lucide-react-native';

import { TabScreen } from '../../src/components/TabScreen';
import { PressScale } from '../../src/components/PressScale';
import { Card, ScreenHeader, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, SearchHit, SearchKind } from '../../src/api';
import { logger } from '../../src/logger';

/**
 * "Where did I put the school form?"
 *
 * By its second week a household's memory is scattered across five screens —
 * a task here, a photographed letter in the vault, a note about the plumber,
 * a meal plan with the recipe inside it. Remembering WHICH screen is the
 * app's job, not the parent's.
 *
 * Results are grouped by where they live and every row lands on the screen
 * that owns it, so finding something and acting on it are one gesture apart.
 */

const KIND_META: Record<SearchKind, { icon: any; tone: keyof UIColors; soft: keyof UIColors; group: string }> = {
  task:     { icon: StickyNote,       tone: 'orange',       soft: 'orangeSoft', group: 'search_group_tasks' },
  event:    { icon: CalendarIcon,     tone: 'lavenderText', soft: 'lavender',   group: 'search_group_events' },
  note:     { icon: StickyNote,       tone: 'goldText',     soft: 'gold',       group: 'search_group_notes' },
  document: { icon: FileText,         tone: 'mintText',     soft: 'mint',       group: 'search_group_documents' },
  shopping: { icon: ShoppingCart,     tone: 'orange',       soft: 'orangeSoft', group: 'search_group_shopping' },
  meal:     { icon: UtensilsCrossed,  tone: 'mintText',     soft: 'mint',       group: 'search_group_meals' },
};

const DESTINATION: Record<SearchKind, string> = {
  task: '/(tabs)/feed',
  event: '/(tabs)/calendar',
  note: '/(tabs)/feed',
  document: '/(tabs)/vault',
  shopping: '/(tabs)/kitchen',
  meal: '/(tabs)/kitchen',
};

const GROUP_ORDER: SearchKind[] = ['task', 'event', 'note', 'document', 'shopping', 'meal'];

export default function SearchScreen() {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const styles = createStyles(ui);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  // Only the most recent request may write results: typing "milk" fires four
  // searches and the answer to "mil" must not overwrite the answer to "milk".
  const latest = useRef(0);

  const run = useCallback(async (raw: string) => {
    const term = raw.trim();
    const mine = ++latest.current;
    if (term.length < 2) {
      setHits([]);
      setTruncated(false);
      setSearched(false);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const res = await api.search(term);
      if (mine !== latest.current) return;
      setHits(res.results);
      setTruncated(res.truncated);
      setSearched(true);
    } catch (e) {
      if (mine !== latest.current) return;
      logger.warn('search failed', e);
      setHits([]);
      setSearched(true);
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  }, []);

  // Wait for a pause in typing rather than firing on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => { run(query); }, 260);
    return () => clearTimeout(timer);
  }, [query, run]);

  const groups = GROUP_ORDER
    .map((kind) => ({ kind, rows: hits.filter((h) => h.kind === kind) }))
    .filter((g) => g.rows.length > 0);

  return (
    <TabScreen tab="Search" refreshing={false} onRefresh={() => run(query)}
      scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}>
      <ScreenHeader
        eyebrow={t('search_eyebrow')}
        title={t('search_title')}
        titleSize={34}
        right={
          <PressScale
            testID="search-back"
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            onPress={() => router.navigate('/(tabs)/feed' as never)}
            style={styles.iconBtn}
          >
            <ChevronLeft color={ui.text} size={20} />
          </PressScale>
        }
      />

      <Card style={styles.box}>
        <SearchIcon color={ui.muted} size={19} />
        <TextInput
          testID="search-input"
          value={query}
          onChangeText={setQuery}
          placeholder={t('search_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => run(query)}
          accessibilityLabel={t('search_placeholder')}
        />
        {query.length > 0 ? (
          <PressScale
            testID="search-clear"
            accessibilityRole="button"
            accessibilityLabel={t('clear')}
            onPress={() => setQuery('')}
            style={styles.clearBtn}
          >
            <X color={ui.muted} size={16} />
          </PressScale>
        ) : null}
      </Card>

      {busy ? <ActivityIndicator color={ui.orange} style={{ marginTop: 22 }} /> : null}

      {!busy && searched && hits.length === 0 ? (
        <View testID="search-empty" style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('search_no_results', { query: query.trim() })}</Text>
          <Text style={styles.emptyBody}>{t('search_no_results_hint')}</Text>
        </View>
      ) : null}

      {!busy && !searched && query.trim().length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyBody}>{t('search_prompt')}</Text>
        </View>
      ) : null}

      {groups.map(({ kind, rows }) => {
        const meta = KIND_META[kind];
        const Icon = meta.icon;
        return (
          <View key={kind} style={styles.group}>
            <Text style={styles.groupLabel}>{t(meta.group)} · {rows.length}</Text>
            <Card style={styles.groupCard}>
              {rows.map((hit, index) => (
                <PressScale
                  key={`${hit.kind}-${hit.id}`}
                  testID={`search-hit-${hit.id}`}
                  accessibilityRole="button"
                  onPress={() => router.navigate(DESTINATION[hit.kind] as never)}
                  style={[styles.row, index > 0 && styles.rowDivider]}
                >
                  <View style={[styles.tile, { backgroundColor: ui[meta.soft] as string }]}>
                    <Icon color={ui[meta.tone] as string} size={17} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{hit.title}</Text>
                    {hit.subtitle ? (
                      <Text style={styles.rowSub} numberOfLines={1}>{hit.subtitle}</Text>
                    ) : null}
                  </View>
                  {/* A private document says so here too — someone searching
                      their own vault should never have to guess whether a
                      result is one their co-parent can also see. */}
                  {hit.kind === 'document' && hit.status === 'private' ? (
                    <Lock color={ui.muted} size={14} />
                  ) : null}
                </PressScale>
              ))}
            </Card>
          </View>
        );
      })}

      {truncated ? <Text style={styles.truncated}>{t('search_truncated')}</Text> : null}
    </TabScreen>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    scroll: { paddingHorizontal: 18, paddingTop: 6, gap: 4 },
    iconBtn: { padding: 8, borderRadius: 999, backgroundColor: ui.soft },
    box: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
    input: {
      flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 16,
      // Web focus rings on a field that already sits inside a bordered card
      // read as a double border.
      outlineStyle: 'none' as never,
    },
    clearBtn: { padding: 5, borderRadius: 999, backgroundColor: ui.soft },
    empty: { paddingTop: 34, paddingHorizontal: 8, gap: 6, alignItems: 'center' },
    emptyTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'center' },
    emptyBody: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13.5, textAlign: 'center', lineHeight: 20 },
    group: { marginTop: 18, gap: 8 },
    groupLabel: {
      color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 11.5,
      letterSpacing: 0.8, textTransform: 'uppercase', paddingLeft: 4,
    },
    groupCard: { padding: 0, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
    rowDivider: { borderTopWidth: 1, borderTopColor: ui.line },
    tile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
    rowSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 1 },
    truncated: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, textAlign: 'center', marginTop: 16 },
  });
