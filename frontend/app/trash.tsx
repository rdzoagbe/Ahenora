/**
 * Recently deleted ("Récemment supprimés").
 *
 * Asked for on 2026-11-10: "if I mistakenly deleted my list I can restore
 * recently deleted without putting back all the list, and it should be the
 * same for any place where we have data stored". Everything deleted in the
 * last 30 days is here, newest first, and each thing comes back on its own.
 * A cleared list is one row that opens onto its items, so one line can come
 * back without the rest. After 30 days the server erases it by itself.
 *
 * What a person sees is what they could see before it was deleted: a
 * private task or a Coffre document only by its owner, a helper nothing that
 * needed a parent to delete (the server decides; this lists what it sends).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Trash2 } from 'lucide-react-native';
import { PressScale } from '../src/components/PressScale';
import ErrorState from '../src/components/ErrorState';
import AppToast from '../src/components/AppToast';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { useToast } from '../src/hooks/useToast';
import { api } from '../src/api';
import type { TrashEntry } from '../src/api';
import { restoreErrorText } from '../src/trashUndo';
import { daysLeft, trashRows } from '../src/trashRows';
import { turnWhen } from '../src/whoseTurn';
import { logger } from '../src/logger';

export default function TrashRoute() {
  const router = useRouter();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const { t, bumpData } = useStore();
  const { toast, showToast } = useToast();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await api.listTrash());
      setFailed(false);
    } catch (e) {
      logger.warn('trash load failed', e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => trashRows(entries), [entries]);

  const restore = async (key: string, run: () => Promise<unknown>, gone: (e: TrashEntry) => boolean) => {
    if (busy) return;
    setBusy(key);
    try {
      await run();
      setEntries((prev) => prev.filter((e) => !gone(e)));
      // The lists it came back to read it again.
      bumpData();
      showToast(t('trash_restored'), 'success');
    } catch (e) {
      showToast(restoreErrorText(e, t), 'error');
      load();
    } finally {
      setBusy(null);
    }
  };

  const erase = (entry: TrashEntry) => {
    Alert.alert(t('trash_erase_q'), t('trash_erase_body'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('trash_erase'),
        style: 'destructive',
        onPress: async () => {
          setEntries((prev) => prev.filter((e) => e.trash_id !== entry.trash_id));
          try {
            await api.purgeTrash(entry.trash_id);
          } catch (e) {
            logger.warn('trash purge failed', e);
            showToast(t('trash_restore_failed'), 'error');
            load();
          }
        },
      },
    ]);
  };

  const emptyAll = () => {
    Alert.alert(t('trash_empty_all_q'), t('trash_empty_all_body'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('trash_empty_all'),
        style: 'destructive',
        onPress: async () => {
          setEntries([]);
          try {
            await api.emptyTrash();
          } catch (e) {
            logger.warn('trash empty failed', e);
            showToast(t('trash_restore_failed'), 'error');
            load();
          }
        },
      },
    ]);
  };

  const subLine = (entry: TrashEntry) => {
    const days = daysLeft(entry.expires_at);
    return [
      t(`trash_kind_${entry.kind}`),
      t('trash_by', { name: entry.deleted_by_name || '—', when: turnWhen(entry.deleted_at, t) }),
      days === 1 ? t('trash_day_left') : t('trash_days_left', { n: days }),
    ].join(' · ');
  };

  const restoreButton = (key: string, onPress: () => void, testID: string) => (
    <PressScale testID={testID} accessibilityRole="button" accessibilityLabel={t('trash_restore')}
      onPress={onPress} disabled={busy !== null} style={[styles.ghostBtn, busy === key && styles.dim]}>
      <RotateCcw color={ui.text} size={14} />
      <Text style={styles.ghostBtnText}>{t('trash_restore')}</Text>
    </PressScale>
  );

  // Inside an opened list each item has the list's own line above it.
  const entryRow = (entry: TrashEntry, first: boolean, inBatch = false) => (
    <View key={entry.trash_id} style={[styles.row, !first && styles.rowLine]} testID={`trash-${entry.trash_id}`}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={2}>{entry.label || '—'}</Text>
        {inBatch ? null : <Text style={styles.sub} numberOfLines={2}>{subLine(entry)}</Text>}
      </View>
      {restoreButton(entry.trash_id,
        () => restore(entry.trash_id, () => api.restoreTrash(entry.trash_id), (e) => e.trash_id === entry.trash_id),
        `trash-restore-${entry.trash_id}`)}
      <PressScale testID={`trash-erase-${entry.trash_id}`} accessibilityRole="button" accessibilityLabel={t('trash_erase')}
        onPress={() => erase(entry)} hitSlop={8} style={styles.deleteBtn}>
        <Trash2 color={ui.danger} size={15} />
      </PressScale>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale
          testID="trash-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/settings' as never))}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <Text style={styles.headTitle} numberOfLines={1}>{t('trash_title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>{t('trash_sub')}</Text>
        {loading ? (
          <ActivityIndicator color={ui.orange} style={{ paddingVertical: 32 }} />
        ) : failed && entries.length === 0 ? (
          <ErrorState onRetry={() => { setLoading(true); load(); }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty} testID="trash-empty">{t('trash_empty')}</Text>
        ) : (
          <View style={styles.card}>
            {rows.map((row, i) => {
              if ('single' in row) return entryRow(row.single, i === 0);
              const isOpen = open.has(row.batch);
              const newest = row.entries[0];
              return (
                <View key={row.key} style={i > 0 && styles.rowLine} testID={`trash-batch-${row.batch}`}>
                  <View style={styles.row}>
                    <PressScale
                      testID={`trash-batch-open-${row.batch}`}
                      accessibilityRole="button"
                      onPress={() => setOpen((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.batch)) next.delete(row.batch); else next.add(row.batch);
                        return next;
                      })}
                      style={styles.batchHead}
                    >
                      {isOpen ? <ChevronDown color={ui.muted} size={16} /> : <ChevronRight color={ui.muted} size={16} />}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.name}>{t(newest.kind === 'meal' ? 'trash_batch_meal' : 'trash_batch', { n: row.entries.length })}</Text>
                        <Text style={styles.sub} numberOfLines={2}>{subLine(newest)}</Text>
                      </View>
                    </PressScale>
                    {restoreButton(row.batch,
                      () => restore(row.batch, () => api.restoreTrashBatch(row.batch), (e) => e.batch_id === row.batch),
                      `trash-restore-batch-${row.batch}`)}
                  </View>
                  {isOpen ? (
                    <View style={styles.batchItems}>
                      {row.entries.map((entry, j) => entryRow(entry, j === 0, true))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {!loading && entries.length > 0 ? (
          <PressScale testID="trash-empty-all" accessibilityRole="button" onPress={emptyAll} style={styles.emptyAll}>
            <Trash2 color={ui.danger} size={15} />
            <Text style={styles.emptyAllText}>{t('trash_empty_all')}</Text>
          </PressScale>
        ) : null}
      </ScrollView>
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} action={toast?.action ?? null} />
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
  headTitle: { flex: 1, textAlign: 'center', fontFamily: 'Figtree_800ExtraBold', fontSize: 18, color: ui.text },
  scroll: { padding: 16, paddingBottom: 48, gap: 14 },
  intro: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 13.5, lineHeight: 19, paddingHorizontal: 4 },
  empty: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  card: {
    backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: ui.line },
  name: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
  sub: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12, marginTop: 2 },
  batchHead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  batchItems: { paddingLeft: 22 },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10,
    borderRadius: 15, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
  },
  ghostBtnText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 12 },
  deleteBtn: { padding: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  dim: { opacity: 0.5 },
  emptyAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  emptyAllText: { color: ui.danger, fontFamily: 'Figtree_700Bold', fontSize: 13.5 },
});
