import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Camera, Plus, Trash2, TrendingDown, TrendingUp, Scale } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, Expense, ExpenseOverview, MerchantRow, ScannedReceipt,
  SettlementInfo } from '../api';
import { localeFor } from '../utils/date';
import { logger } from '../logger';
import { apiErrorText } from '../apiError';

const CATEGORY = 'Groceries';
const MONTHS = 6;

/** "2026-07" → a Date on the first of that month, for formatting only. */
function monthDate(key: string): Date {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1);
}

/**
 * A till receipt writes 47,30 in France and 47.30 in Britain, and a person
 * typing quickly may do either. Reading the comma as a thousands separator
 * would put a 4 730 € shop in the family's year, so both are accepted and both
 * mean the same thing.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * What the household spends on the shopping, by month and by shop.
 *
 * Lives in two places on purpose: as the Spending tab inside Kitchen, which is
 * where someone already is when they come back from the shop, and behind the
 * /expenses address so older links still open something. `embedded` decides
 * only whether this scrolls itself — inside Kitchen the tab already scrolls,
 * and a scroller inside a scroller swallows the gesture.
 *
 * Two rules from the server are repeated here rather than hidden, because they
 * are the difference between a number that helps and a number that misleads:
 * every total shows how many receipts it is built from, and a month still
 * running is never compared to a finished one.
 *
 * Typing comes before the camera deliberately. A total read off a crumpled till
 * slip can pick up the cash tendered instead of the amount paid, and a wrong
 * figure does not announce itself — it quietly makes six months of history
 * false. Eight seconds of typing is right every time.
 */
export function SpendingView({ embedded = false }: { embedded?: boolean }) {
  const ui = useUI();
  const { t, lang } = useStore();
  const styles = createStyles(ui);
  const locale = localeFor(lang);
  const money = (n: number) => `${t('currency_symbol')}${n.toFixed(2)}`;

  const [overview, setOverview] = useState<ExpenseOverview | null>(null);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSix, setShowSix] = useState(false);

  const [adding, setAdding] = useState(false);
  const [shop, setShop] = useState('');
  const [amount, setAmount] = useState('');
  const [when, setWhen] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [splitOn, setSplitOn] = useState(false);
  const [settlement, setSettlement] = useState<SettlementInfo | null>(null);
  const [settling, setSettling] = useState(false);

  // Receipt capture. `scan` holds what the reader made of the photo — nothing
  // is saved until the lines have been looked at, the same posture the
  // shopping-list scan already takes.
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<ScannedReceipt | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);


  const load = useCallback(async () => {
    try {
      const [data, list, settle] = await Promise.all([
        api.getExpenseOverview(MONTHS, CATEGORY),
        api.listExpenses(120),
        api.getSettlement().catch(() => null),
      ]);
      setOverview(data);
      setRecent(list.filter((e) => (e.category || 'General') === CATEGORY));
      setSettlement(settle);
    } catch (e) {
      logger.warn('expenses load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    const value = parseAmount(amount);
    if (value === null) {
      Alert.alert(t('exp_bad_amount_title'), t('exp_bad_amount_body'));
      return;
    }
    setSaving(true);
    try {
      await api.addExpense({
        merchant: shop.trim(),
        description: shop.trim(),
        amount: value,
        category: CATEGORY,
        spent_on: when,
        split: splitOn,
      });
      setShop('');
      setAmount('');
      setWhen(todayISO());
      setSplitOn(false);
      setAdding(false);
      await load();
    } catch (e: any) {
      logger.warn('expense save failed', e);
      Alert.alert(t('exp_save_failed'), e?.message || '');
    } finally {
      setSaving(false);
    }
  }, [shop, amount, when, splitOn, load, t]);

  /**
   * Photograph the receipt and read it.
   *
   * Nothing is saved here. The lines come back as candidates and go into a
   * review sheet with the unsure ones unticked, exactly like the shopping-list
   * scan — a misread PRICE is worse than a misread item, because it does not
   * look wrong. It just quietly makes every later comparison false.
   */
  const captureReceipt = useCallback(async (source: 'camera' | 'library') => {
    setScanError(null);
    try {
      if (Platform.OS !== 'web') {
        const perm = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          throw new Error(t(source === 'camera'
            ? 'cam_camera_permission_denied' : 'cam_gallery_permission_denied'));
        }
      }
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.55, mediaTypes: ImagePicker.MediaTypeOptions.Images })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.55, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      // Native hands back base64; web hands back a data URL instead.
      const base64 = asset.base64 ?? (asset.uri?.startsWith('data:') ? asset.uri.split(',')[1] : null);
      if (!base64) return;

      setScanning(true);
      const read = await api.scanReceipt(base64);
      setScan(read);
      // Unsure lines start unticked. Saying "no" to a bad read must be the
      // lazy option, not the diligent one.
      setKeep(read.items.map((i) => !i.unsure));
      setShop(read.shop || '');
      setAmount(read.total ? String(read.total.toFixed(2)) : '');
      // An unreadable date comes back empty and today is the honest default —
      // it is at least a date the person can see is wrong.
      setWhen(read.date || todayISO());
    } catch (e: any) {
      logger.warn('receipt scan failed', e);
      // Running out of allowance must not cost the expense. The reading is what
      // the allowance buys; typing the total was always available and stays so.
      setScanError(apiErrorText(e, t, 'exp_scan_failed'));
    } finally {
      setScanning(false);
    }
  }, [t]);

  /** Commit the reviewed receipt: the expense, and the lines kept with it. */
  const saveScanned = useCallback(async () => {
    if (!scan) return;
    const value = parseAmount(amount);
    if (value === null) {
      Alert.alert(t('exp_bad_amount_title'), t('exp_bad_amount_body'));
      return;
    }
    setSaving(true);
    try {
      await api.addExpense({
        merchant: shop.trim(),
        description: shop.trim(),
        amount: value,
        category: CATEGORY,
        spent_on: when,
        split: splitOn,
        items: scan.items
          .filter((_, i) => keep[i])
          .map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, line_total: i.line_total })),
      });
      setScan(null);
      setKeep([]);
      setShop('');
      setAmount('');
      setWhen(todayISO());
      setSplitOn(false);
      await load();
    } catch (e: any) {
      logger.warn('receipt save failed', e);
      Alert.alert(t('exp_save_failed'), e?.message || '');
    } finally {
      setSaving(false);
    }
  }, [scan, keep, amount, shop, when, splitOn, load, t]);

  const settleUp = useCallback(async () => {
    setSettling(true);
    try {
      setSettlement(await api.settleUp());
    } catch (e: any) {
      logger.warn('settle up failed', e);
      Alert.alert(t('exp_save_failed'), e?.message || '');
    } finally {
      setSettling(false);
    }
  }, [t]);

  const remove = useCallback(async (id: string) => {
    try {
      await api.deleteExpense(id);
      await load();
    } catch (e) {
      logger.warn('expense delete failed', e);
    }
  }, [load]);

  // The month to lead with: the newest finished month if there is one, because
  // that is the month we can actually say something about. Otherwise the month
  // in progress, shown without a comparison.
  const lead = useMemo(() => {
    if (!overview) return null;
    const finished = overview.months.filter((m) => m.complete && m.count > 0);
    return finished.length ? finished[finished.length - 1] : overview.current;
  }, [overview]);

  const monthName = (key: string) =>
    monthDate(key).toLocaleDateString(locale, { month: 'long' });

  const shopsLabel = (n: number) =>
    n === 1 ? t('exp_shops_one') : t('exp_shops_other', { n });

  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const comparison = overview?.comparison;
  const showsComparison = Boolean(comparison && lead && comparison.month === lead.month);
  const difference = comparison ? comparison.difference : 0;
  const meaningful = Math.abs(difference) >= 5;

  const merchantRows: MerchantRow[] = showSix
    ? (overview?.range.by_merchant ?? [])
    : (lead?.by_merchant ?? []);

  const chartMax = Math.max(1, ...(overview?.months ?? []).map((m) => m.total));

  const Wrapper: any = embedded ? View : ScrollView;
  const wrapperProps = embedded
    // Kitchen already pads its content by 20, so the embedded copy adds none
    // of its own — 36px of inset on a 320px phone is how a layout gets cramped.
    ? { style: styles.bodyEmbedded }
    : { contentContainerStyle: styles.body, keyboardShouldPersistTaps: 'handled' as const };

  return (
    <View style={styles.root}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>
      ) : (
        <Wrapper {...wrapperProps}>

          {/* The two ways in, at the top.

              The add button used to sit at the very bottom — under the summary,
              the chart, "who paid", "where it went" and up to twenty receipt
              rows. On a household with any history that is three screens of
              scrolling, so the primary action of the screen was the least
              reachable thing on it, and it read as missing. */}
          {!scan ? (
            <View style={styles.actionRow}>
              <PressScale
                testID="exp-scan-receipt"
                onPress={() => captureReceipt('camera')}
                disabled={scanning}
                style={[styles.primary, styles.actionHalf, scanning && styles.dim]}
              >
                <Camera color="#fff" size={17} />
                <Text style={styles.primaryText}>
                  {scanning ? t('exp_scan_reading') : t('exp_scan_receipt')}
                </Text>
              </PressScale>
              <PressScale
                testID="exp-add-open"
                onPress={() => setAdding((v) => !v)}
                style={[styles.ghost, styles.actionHalf]}
              >
                <Plus color={ui.text} size={17} />
                <Text style={styles.ghostText}>{t('exp_add')}</Text>
              </PressScale>
            </View>
          ) : null}
          {scanError ? <Text style={styles.scanErr}>{scanError}</Text> : null}

          {/* One month or six — the same screen, so there is nothing new to learn. */}
          <View style={styles.seg}>
            <PressScale testID="exp-tab-month" onPress={() => setShowSix(false)} style={[styles.segBtn, !showSix && styles.segOn]}>
              <Text style={[styles.segText, !showSix && styles.segTextOn]}>{t('exp_tab_month')}</Text>
            </PressScale>
            <PressScale testID="exp-tab-six" onPress={() => setShowSix(true)} style={[styles.segBtn, showSix && styles.segOn]}>
              <Text style={[styles.segText, showSix && styles.segTextOn]}>{t('exp_tab_six')}</Text>
            </PressScale>
          </View>

          {/* ---- The headline number ---- */}
          <View style={styles.card}>
            {showSix ? (
              <>
                <Text style={styles.lbl}>{t('exp_tab_six')}</Text>
                <Text style={styles.big}>{money(overview?.range.total ?? 0)}</Text>
                <Text style={styles.sub}>{shopsLabel(overview?.range.count ?? 0)}</Text>

                <View style={styles.chart}>
                  {(overview?.months ?? []).map((m) => (
                    <View key={m.month} style={styles.col}>
                      <View
                        style={[
                          styles.stick,
                          { height: `${Math.round((m.total / chartMax) * 100)}%` },
                          !m.complete && styles.stickNow,
                        ]}
                      />
                      <Text style={[styles.colLbl, !m.complete && styles.colLblNow]}>
                        {monthDate(m.month).toLocaleDateString(locale, { month: 'narrow' })}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.lbl}>
                  {lead ? monthName(lead.month) : ''}
                  {lead && !lead.complete ? ` · ${t('exp_so_far')}` : ''}
                </Text>
                <Text style={styles.big}>{money(lead?.total ?? 0)}</Text>
                {/* How much of the month this number actually covers. Without it,
                    a month where four receipts were forgotten reads as restraint. */}
                <Text style={styles.sub}>{shopsLabel(lead?.count ?? 0)}</Text>

                {showsComparison && comparison ? (
                  meaningful ? (
                    <View style={styles.compare}>
                      {difference > 0
                        ? <TrendingUp color={ui.orangeDeep} size={16} />
                        : <TrendingDown color={ui.mintText} size={16} />}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.compareText, difference < 0 && styles.compareGood]}>
                          {difference > 0
                            ? t('exp_more_usual', { amount: money(Math.abs(difference)) })
                            : t('exp_less_usual', { amount: money(Math.abs(difference)) })}
                        </Text>
                        {/* "Usual" says what it means, on the line beneath it. */}
                        <Text style={styles.compareWhy}>
                          {t('exp_usual_note', {
                            months: comparison.basis_months.map(monthName).join(', '),
                          })}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.compare}>
                      <Text style={styles.compareWhy}>{t('exp_same_usual')}</Text>
                    </View>
                  )
                ) : (
                  <View style={styles.pending}>
                    <Text style={styles.compareWhy}>
                      {overview && overview.current.count > 0 && !overview.comparison
                        ? t('exp_not_enough_yet')
                        : t('exp_wait_for_month_end', { month: monthName(overview?.current.month ?? '') })}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>

          {/* ---- Settle up. Only when there are two parents and something has
                   been split — a co-parent's running tally, honestly tracked. ---- */}
          {settlement?.enabled && (settlement.shared_count ?? 0) > 0 ? (
            <View style={[styles.card, styles.settleCard]}>
              <View style={styles.settleHead}>
                <Scale color={ui.lavenderText} size={18} />
                <Text style={styles.settleTitle} numberOfLines={2}>
                  {settlement.balance > 0.005
                    ? t('exp_settle_owes_you', { name: settlement.other_name || '', amount: money(Math.abs(settlement.balance)) })
                    : settlement.balance < -0.005
                      ? t('exp_settle_you_owe', { name: settlement.other_name || '', amount: money(Math.abs(settlement.balance)) })
                      : t('exp_settle_square', { name: settlement.other_name || '' })}
                </Text>
              </View>
              <Text style={styles.settleNote}>{t('exp_settle_note')}</Text>
              {Math.abs(settlement.balance) >= 0.01 ? (
                <PressScale testID="exp-settle" onPress={settleUp} disabled={settling} style={[styles.settleBtn, settling && styles.dim]}>
                  <Text style={styles.settleBtnText}>{settling ? t('exp_saving') : t('exp_settle_mark')}</Text>
                </PressScale>
              ) : null}
            </View>
          ) : null}

          {/* ---- Who paid. The older job of this screen, kept on the same page
                   rather than in a second place to look. ---- */}
          {!showSix && lead && Object.keys(lead.by_person).length > 1 ? (
            <View style={styles.card}>
              <Text style={styles.lbl}>{t('exp_who_paid')}</Text>
              {Object.entries(lead.by_person).map(([name, paid], i) => (
                <View key={name} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <Text style={[styles.shopName, { flex: 1 }]} numberOfLines={1}>{name}</Text>
                  <Text style={styles.rowAmount}>{money(paid)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ---- Where it went ---- */}
          <View style={styles.card}>
            <Text style={styles.lbl}>{t('exp_where')}</Text>
            {merchantRows.length === 0 ? (
              <Text style={styles.empty}>{t('exp_empty')}</Text>
            ) : merchantRows.map((row, i) => (
              <View key={row.merchant} style={[styles.row, i > 0 && styles.rowDivider]}>
                <View style={styles.shopCell}>
                  <View style={styles.mark}>
                    <Text style={styles.markText}>{row.merchant.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shopName} numberOfLines={1}>{row.merchant}</Text>
                    <Text style={styles.shopSub}>
                      {shopsLabel(row.visits)}
                      {/* The per-visit average is the number a family can act on:
                          the monthly total says whether they spent more, this
                          says where it goes. */}
                      {showSix ? ` · ${t('exp_each', { amount: money(row.average) })}` : ''}
                    </Text>
                  </View>
                </View>
                <Text style={styles.rowAmount}>{money(row.total)}</Text>
              </View>
            ))}
          </View>

          {/* ---- The receipts themselves ---- */}
          {!showSix ? (
            <View style={styles.card}>
              <Text style={styles.lbl}>{t('exp_receipts')}</Text>
              {recent.length === 0 ? (
                <Text style={styles.empty}>{t('exp_empty')}</Text>
              ) : recent.slice(0, 20).map((e, i) => (
                <View key={e.expense_id} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.shopName} numberOfLines={1}>{e.merchant || e.description}</Text>
                    <Text style={styles.shopSub}>{dayLabel(e.spent_on)} · {e.paid_by_name}{e.split ? ` · ${t('exp_split_tag')}` : ''}</Text>
                  </View>
                  <Text style={styles.rowAmount}>{money(e.amount)}</Text>
                  <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y_delete')}
                    onPress={() => remove(e.expense_id)}
                    hitSlop={10}
                    style={styles.del}
                  >
                    <Trash2 color={ui.muted} size={15} />
                  </PressScale>
                </View>
              ))}
            </View>
          ) : null}

          {/* ---- The receipt, for review ----

              Everything here is a candidate. The point of showing the lines at
              all, rather than just the total, is that the total compares basket
              SIZES between shops while the lines compare prices — but a line is
              only worth keeping if it is right, so the read is put in front of
              a person before any of it is stored. */}
          {scan ? (
            <View style={styles.card}>
              <Text style={styles.lbl}>{t('exp_scan_review')}</Text>

              {/* The arithmetic, reported and never repaired. If the lines do
                  not add up to the printed total, something was misread — and
                  a wrong price is silent in a way a wrong name is not. */}
              {!scan.reconciles ? (
                <View style={styles.warn}>
                  <Text style={styles.warnText}>
                    {t('exp_scan_mismatch', {
                      lines: money(scan.lines_total), total: money(scan.total),
                    })}
                  </Text>
                </View>
              ) : null}

              <TextInput
                testID="exp-scan-shop"
                style={styles.input}
                value={shop}
                onChangeText={setShop}
                placeholder={t('exp_shop_ph')}
                placeholderTextColor={ui.muted}
                maxLength={60}
              />
              <TextInput
                testID="exp-scan-total"
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder={t('exp_amount_ph')}
                placeholderTextColor={ui.muted}
                keyboardType="decimal-pad"
                maxLength={10}
              />
              <TextInput
                testID="exp-scan-date"
                style={styles.input}
                value={when}
                onChangeText={setWhen}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={ui.muted}
                maxLength={10}
              />
              {!scan.date ? <Text style={styles.hint}>{t('exp_scan_no_date')}</Text> : null}

              {scan.items.map((item, i) => (
                <PressScale
                  key={`${item.name}-${i}`}
                  testID={`exp-scan-line-${i}`}
                  onPress={() => setKeep((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                  style={[styles.row, i > 0 && styles.rowDivider]}
                >
                  <View style={[styles.tick, keep[i] && styles.tickOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.shopName, !keep[i] && styles.rowOff]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.shopSub}>
                      {/* The per-unit price is the number that can be compared
                          with another shop. A line whose amount could not be
                          read has none, and says so rather than showing a
                          figure that means nothing. */}
                      {item.unit_price != null && item.qty != null
                        ? `${item.qty}${item.unit === 'piece' ? '' : ' ' + item.unit} · ${money(item.unit_price)}/${item.unit}`
                        : t('exp_scan_no_unit')}
                      {item.unsure ? ` · ${t('exp_scan_unsure')}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, !keep[i] && styles.rowOff]}>
                    {money(item.line_total)}
                  </Text>
                </PressScale>
              ))}

              <PressScale
                testID="exp-scan-save"
                onPress={saveScanned}
                disabled={saving}
                style={[styles.primary, saving && styles.dim]}
              >
                <Text style={styles.primaryText}>{saving ? t('exp_saving') : t('exp_save')}</Text>
              </PressScale>
              <PressScale onPress={() => { setScan(null); setKeep([]); }} style={styles.quiet}>
                <Text style={styles.quietText}>{t('cancel')}</Text>
              </PressScale>
            </View>
          ) : null}

          {/* ---- Add one ---- */}
          {adding ? (
            <View style={styles.card}>
              <Text style={styles.lbl}>{t('exp_add')}</Text>
              <TextInput
                testID="exp-shop"
                style={styles.input}
                value={shop}
                onChangeText={setShop}
                placeholder={t('exp_shop_ph')}
                placeholderTextColor={ui.muted}
                autoCapitalize="words"
                maxLength={60}
              />
              <TextInput
                testID="exp-amount"
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder={t('exp_amount_ph')}
                placeholderTextColor={ui.muted}
                keyboardType="decimal-pad"
                maxLength={10}
              />
              <TextInput
                testID="exp-date" returnKeyType="done" onSubmitEditing={() => save()}
                style={styles.input}
                value={when}
                onChangeText={setWhen}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={ui.muted}
                maxLength={10}
              />
              <Text style={styles.hint}>{t('exp_date_hint')}</Text>
              {/* Split with the co-parent — only offered when there are two of
                  them, and off unless deliberately turned on. */}
              {settlement?.enabled ? (
                <View style={styles.splitRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.splitLabel}>{t('exp_split_with', { name: settlement.other_name || '' })}</Text>
                    <Text style={styles.splitSub}>{t('exp_split_help')}</Text>
                  </View>
                  <Switch
                    testID="exp-split"
                    value={splitOn}
                    onValueChange={setSplitOn}
                    trackColor={{ true: ui.lavenderText, false: ui.line }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              ) : null}
              <PressScale testID="exp-save" onPress={save} disabled={saving} style={[styles.primary, saving && styles.dim]}>
                <Text style={styles.primaryText}>{saving ? t('exp_saving') : t('exp_save')}</Text>
              </PressScale>
              <PressScale onPress={() => setAdding(false)} style={styles.quiet}>
                <Text style={styles.quietText}>{t('cancel')}</Text>
              </PressScale>
            </View>
          ) : null}
        </Wrapper>
      )}
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 12 },
  bodyEmbedded: { paddingTop: 2, paddingBottom: 8, gap: 12 },

  seg: {
    flexDirection: 'row', gap: 4, padding: 3,
    backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 12,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segOn: { backgroundColor: ui.card },
  segText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.muted },
  segTextOn: { color: ui.text },

  card: {
    backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
    borderRadius: 16, padding: 14, gap: 10,
  },
  lbl: {
    fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6,
    textTransform: 'uppercase', color: ui.muted,
  },
  big: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, color: ui.text, marginTop: -4 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.muted, marginTop: -6 },

  compare: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: ui.orangeSoft, borderRadius: 12, padding: 10,
  },
  compareText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.orangeDeep },
  compareGood: { color: ui.mintText },
  compareWhy: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: ui.muted, marginTop: 2 },
  pending: { backgroundColor: ui.soft, borderRadius: 12, padding: 10 },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 96, marginTop: 4 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  stick: { width: '100%', borderRadius: 6, backgroundColor: ui.orangeSoft, minHeight: 3 },
  stickNow: { backgroundColor: ui.orange },
  colLbl: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: ui.muted },
  colLblNow: { color: ui.orangeText },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: ui.line, paddingTop: 10, marginTop: 2 },
  shopCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: ui.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  markText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: ui.muted },
  shopName: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: ui.text },
  shopSub: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: ui.muted },
  rowAmount: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: ui.text },
  del: { padding: 4 },

  empty: { fontFamily: 'Inter_500Medium', fontSize: 13, color: ui.muted, paddingVertical: 6 },

  input: {
    minHeight: 46, borderRadius: 12, backgroundColor: ui.soft,
    borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14,
    fontFamily: 'Inter_500Medium', fontSize: 15, color: ui.text,
  },
  hint: { fontFamily: 'Inter_500Medium', fontSize: 11.5, color: ui.muted, marginTop: -4 },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 14,
  },
  primaryText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff' },
  dim: { opacity: 0.6 },
  settleCard: { borderColor: ui.lavenderText, borderWidth: 1 },
  settleHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settleTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  settleNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  settleBtn: { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: ui.lavenderText },
  settleBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, marginBottom: 6 },
  splitLabel: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  splitSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  quiet: { alignItems: 'center', paddingVertical: 10 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionHalf: { flex: 1, marginTop: 0 },
  ghost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
    borderRadius: 14, paddingVertical: 14,
  },
  ghostText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: ui.text },
  scanErr: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.danger },
  warn: { backgroundColor: ui.orangeSoft, borderRadius: 12, padding: 10 },
  warnText: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.orangeText },
  tick: {
    width: 18, height: 18, borderRadius: 5, marginRight: 10,
    borderWidth: 1.5, borderColor: ui.line,
  },
  tickOn: { backgroundColor: ui.orange, borderColor: ui.orange },
  rowOff: { color: ui.muted, textDecorationLine: 'line-through' },
  quietText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: ui.muted },
});
