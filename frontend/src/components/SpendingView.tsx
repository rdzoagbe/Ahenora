import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Plus, Trash2, TrendingDown, TrendingUp, Scale } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, Expense, ExpenseOverview, MerchantRow, SettlementInfo } from '../api';
import { localeFor } from '../utils/date';
import { logger } from '../logger';

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
                testID="exp-date"
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
          ) : (
            <PressScale testID="exp-add-open" onPress={() => setAdding(true)} style={styles.primary}>
              <Plus color="#fff" size={18} />
              <Text style={styles.primaryText}>{t('exp_add')}</Text>
            </PressScale>
          )}
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
  quietText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: ui.muted },
});
