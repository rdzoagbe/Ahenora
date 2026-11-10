import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Camera, Plus, Trash2, TrendingDown, TrendingUp, Scale, Check, ShoppingCart, FileText } from 'lucide-react-native';
import { pickPicture, type PictureSource } from '../pickPicture';
import { pickListFile } from '../pickListFile';

import { PressScale } from './PressScale';
import ErrorState from './ErrorState';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { formatDecimal, formatMoney, formatNumber } from '../money';
import { priceLabel } from '../shopPrices';
import { api, Expense, ExpenseOverview, MerchantRow, ScannedReceipt,
  SettlementInfo, ShoppingItem } from '../api';
import { matchReceiptToList } from '../receiptTicks';
import { splitQuantity } from '../shoppingAisles';
import { localeFor } from '../utils/date';
import { logger } from '../logger';
import { apiErrorText } from '../apiError';

const CATEGORY = 'Groceries';
const MONTHS = 6;
// The receipts card shows this many at a time. The screen used to stop at
// twenty with nothing to say there were more, and the list passed for the
// whole four months the server had sent; "Show older" reaches the rest.
const RECEIPTS_PAGE = 20;

/** "octobre" → "Octobre": a month name at the start of a line. */
function capitalise(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

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

/** What a saved receipt ticked on the shopping list. */
type TickedNote = { shop: string; items: { id: string; name: string }[] };
// Kept for the app's session, outside the view, which unmounts when the
// Dépenses tab is left. Cleared by the next scan or by Annuler, and tied to
// the account that made it: another account signed in on the same phone
// never sees it.
let lastTicked: { owner: string; note: TickedNote } | null = null;
// More names than this and the note says "…" instead of a paragraph.
const TICKED_NAMES_SHOWN = 5;

// Short unit labels for a receipt line: "1,234 kg", "500 g", "1 L".
const UNIT_SHORT: Record<string, string> = { kg: 'kg', g: 'g', l: 'L', ml: 'mL' };

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
// Until the server has said (each read returns max_parts): a receipt in at
// most three photos, as RECEIPT_MAX_PARTS on the server.
const RECEIPT_MAX_PARTS = 3;

export function SpendingView({ embedded = false }: { embedded?: boolean }) {
  const ui = useUI();
  const { t, lang, bumpData, user } = useStore();
  const owner = user?.user_id ?? '';
  const styles = createStyles(ui);
  const locale = localeFor(lang);
  const money = (n: number) => formatMoney(n, lang);

  const [overview, setOverview] = useState<ExpenseOverview | null>(null);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [receiptsShown, setReceiptsShown] = useState(RECEIPTS_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
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
  // The photos the receipt on review was read from, top to bottom: the next
  // part is read together with them. Empty for a PDF.
  const [parts, setParts] = useState<string[]>([]);
  // More pages were scanned than one receipt can be read from: how many were.
  const [pagesCapped, setPagesCapped] = useState(0);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  // The shopping list, read when a receipt is scanned, so the review can show
  // which of its items this receipt bought. Matches start ticked; the parent
  // unticks any that are wrong before saving (see receiptTicks.ts).
  const [listItems, setListItems] = useState<ShoppingItem[]>([]);
  const [untick, setUntick] = useState<Set<string>>(() => new Set());
  // What the last save ticked, for the note with its Annuler. Remembered past
  // this view: switching to the list to look, then back, must not lose the
  // way to undo it.
  const [ticked, setTickedState] = useState<TickedNote | null>(
    () => (lastTicked && lastTicked.owner === owner ? lastTicked.note : null));
  const setTicked = useCallback((next: TickedNote | null) => {
    lastTicked = next ? { owner, note: next } : null;
    setTickedState(next);
  }, [owner]);
  const [undoing, setUndoing] = useState(false);


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
      setLoadFailed(false);
    } catch (e) {
      // Without this the screen showed "£0 · 0 shops" over a month the family
      // spent plenty in: a failed load is not an empty one.
      logger.warn('expenses load failed', e);
      setLoadFailed(true);
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
   * Read a receipt: one photo, a long one in parts, or a file.
   *
   * Nothing is saved here. The lines come back as candidates and go into a
   * review sheet with the unsure ones unticked, exactly like the shopping-list
   * scan — a misread PRICE is worse than a misread item, because it does not
   * look wrong. It just quietly makes every later comparison false.
   *
   * A failed read leaves the review that was there (adding a part that could
   * not be read does not lose the part that could).
   */
  const figureOf = useCallback((r: ScannedReceipt) => {
    const figure = r.total ?? r.lines_total;
    return figure ? formatDecimal(figure, lang) : '';
  }, [lang]);

  const readReceipt = useCallback(async (
    read: () => Promise<ScannedReceipt>,
    pictures: string[],
    from: 'photo' | 'file',
    // The review this read continues ("Ajouter la suite"): what the person
    // already decided there is kept, not thrown away by the new read.
    previous?: { scan: ScannedReceipt; keep: boolean[]; shop: string; amount: string; when: string },
    // Pages an iPhone's scanner shot past what one receipt is read from.
    dropped = 0,
  ) => {
    try {
      setScanning(true);
      const result = await read();
      // The last receipt's note goes only once this one has been read: a
      // failed scan must not take away the way to undo the previous one.
      setTicked(null);
      setScan(result);
      setParts(pictures);
      // Said about THIS read only: how many pages it was read from, when more
      // were shot. Any other read (a file, a part that fitted) clears it.
      setPagesCapped(dropped > 0 ? pictures.length : 0);
      setUntick(new Set());
      // Only for the review: without the list, nothing is offered to tick.
      api.listShopping().then(setListItems).catch(() => setListItems([]));
      // Unsure lines start unticked. Saying "no" to a bad read must be the
      // lazy option, not the diligent one. A line the person had unticked
      // stays unticked when the receipt is read again with its next part.
      const untickedBefore = new Set(previous
        ? previous.scan.items.filter((_, i) => !previous.keep[i]).map((i) => i.name) : []);
      setKeep(result.items.map((i) => !i.unsure && !untickedBefore.has(i.name)));
      // A shop or a date the person corrected stays corrected.
      setShop(previous && previous.shop !== (previous.scan.shop || '') ? previous.shop : (result.shop || ''));
      setWhen(previous && previous.when !== (previous.scan.date || todayISO())
        ? previous.when : (result.date || todayISO()));
      // Pre-filled the way the reader types money: "9,95" in French, "9.95"
      // in English. No printed total read (the top of a long receipt): the
      // sum of the lines, and the review says that is what it is. A printed
      // total, once read, wins over a figure typed while there was none.
      const typed = previous && previous.amount !== figureOf(previous.scan) ? previous.amount : null;
      setAmount(typed !== null && result.total == null ? typed : figureOf(result));
      // An unreadable date comes back empty and today is the honest default —
      // it is at least a date the person can see is wrong.
    } catch (e: any) {
      logger.warn('receipt scan failed', e);
      // Running out of allowance must not cost the expense. The reading is what
      // the allowance buys; typing the total was always available and stays so.
      // The server's own reasons, in words that fit what was sent.
      setScanError(e?.status === 413
        ? t(from === 'file' ? 'scan_file_too_large' : 'exp_scan_photos_too_large')
        : e?.status === 400
          ? t(from === 'file' ? 'scan_file_not_supported' : 'scan_photo_open_failed')
          : apiErrorText(e, t, 'exp_scan_failed'));
    } finally {
      setScanning(false);
    }
  }, [t, setTicked, figureOf]);

  // allowsEditing for the same reason as the document scanner: a receipt
  // cropped to the receipt is a fraction of the bytes and a far easier read
  // than a photo of a whole worktop.
  // The camera is the phone's document scanner: it frames the receipt itself,
  // straightens it, and lets a long one be shot in up to `room` pages with
  // its own "add a page" and "done" buttons, all read as one receipt. The
  // plain camera (web, a build without the scanner) keeps the system crop
  // step for the same reason: a receipt cropped to the receipt is a
  // fraction of the bytes and a far easier read than a photo of a worktop.
  const pickReceiptPages = useCallback(async (source: PictureSource, room: number): Promise<{ pages: string[]; dropped: number } | null> => {
    const picked = await pickPicture(source, {
      where: '/expenses/scan-receipt', allowsEditing: true, scanner: { maxPages: room },
    });
    if (!picked) return null;
    if ('problem' in picked) {
      setScanError(t(picked.problem === 'camera_denied' ? 'cam_camera_permission_denied' : 'scan_photo_open_failed'));
      return null;
    }
    // pickPicture keeps at most `room` pages (an iPhone's scanner has no cap)
    // and counts the rest; the review says so once the read has worked.
    return { pages: picked.pages, dropped: picked.dropped };
  }, [t]);

  const captureReceipt = useCallback(async (source: PictureSource) => {
    setScanError(null);
    const got = await pickReceiptPages(source, RECEIPT_MAX_PARTS);
    if (!got) return;
    const { pages, dropped } = got;
    await readReceipt(() => api.scanReceipt(pages), pages, 'photo', undefined, dropped);
  }, [pickReceiptPages, readReceipt]);

  /**
   * The rest of a receipt too long for one sharp photo. The parts so far and
   * the new one are read again together, as ONE receipt: the server joins
   * where they overlap and takes the total from wherever it is printed.
   */
  const addReceiptPart = useCallback(async () => {
    setScanError(null);
    const room = (scan?.max_parts ?? RECEIPT_MAX_PARTS) - parts.length;
    const got = await pickReceiptPages('camera', room);
    if (!got) return;
    const pictures = [...parts, ...got.pages];
    const previous = scan ? { scan, keep, shop, amount, when } : undefined;
    await readReceipt(() => api.scanReceipt(pictures, scan?.read_token), pictures, 'photo', previous, got.dropped);
  }, [parts, scan, keep, shop, amount, when, pickReceiptPages, readReceipt]);

  /** A digital receipt (PDF), or a picture of one that is not in the gallery. */
  const importReceiptFile = useCallback(async () => {
    setScanError(null);
    let picked: Awaited<ReturnType<typeof pickListFile>>;
    try {
      picked = await pickListFile();
    } catch (e: any) {
      logger.warn('receipt file failed', e?.message || e);
      setScanError(t('scan_file_open_failed'));
      return;
    }
    if (!picked) return;
    if ('problem' in picked) {
      setScanError(t({
        too_large: 'scan_file_too_large',
        not_supported: 'scan_file_not_supported',
        heic: 'scan_file_heic',
        update_needed: 'vault_files_update_needed',
      }[picked.problem]));
      return;
    }
    const { kind, base64 } = picked;
    if (kind === 'pdf') await readReceipt(() => api.scanReceiptPdf(base64), [], 'file');
    else await readReceipt(() => api.scanReceipt([base64]), [base64], 'file');
  }, [t, readReceipt]);

  /** Commit the reviewed receipt: the expense, and the lines kept with it. */
  // Items on the list this receipt shows were bought, from the lines kept.
  const receiptTicks = useMemo(
    () => (scan ? matchReceiptToList(scan.items.filter((_, i) => keep[i]), listItems) : []),
    [scan, keep, listItems],
  );
  const toTick = receiptTicks.filter((m) => !untick.has(m.item.item_id));

  const undoTicks = useCallback(async () => {
    if (!ticked || undoing) return;
    setUndoing(true);
    try {
      const failed = (await Promise.all(ticked.items.map((i) =>
        api.updateShoppingItem(i.id, { checked: false }).then(() => null).catch(() => i))))
        .filter((i): i is NonNullable<typeof i> => i !== null);
      // Whatever could not be put back stays in the note, so Annuler can be
      // tried again and nobody believes it worked when it did not.
      setTicked(failed.length > 0 ? { ...ticked, items: failed } : null);
      bumpData();
    } finally {
      setUndoing(false);
    }
  }, [ticked, undoing, bumpData, setTicked]);

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
      // Then the list. Only after the expense is safely saved, and each one
      // on its own: one failure leaves the others ticked, and the note says
      // exactly which went through.
      const shopName = shop.trim();
      const done = (await Promise.all(toTick.map((m) =>
        api.updateShoppingItem(m.item.item_id, { checked: true, ticked_from: shopName || undefined })
          .then(() => m).catch(() => null)))).filter((m): m is NonNullable<typeof m> => m !== null);
      if (done.length > 0) {
        setTicked({
          shop: shopName,
          items: done.map((m) => ({ id: m.item.item_id, name: splitQuantity(m.item.name).label })),
        });
        bumpData();
      }
      setListItems([]);
      setUntick(new Set());
      setScan(null);
      setParts([]);
      setPagesCapped(0);
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
  }, [scan, keep, amount, shop, when, splitOn, load, t, toTick, bumpData, setTicked]);

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
      Alert.alert(t('exp_save_failed'), apiErrorText(e, t, 'err_please_try_again'));
    }
  }, [load, t]);

  // "Ce mois-ci" is this month, so far. It used to lead with the newest
  // FINISHED month whenever there was one (the month it could compare), so on
  // 9 November it showed October and left November's receipts out (Roland,
  // 2026-11-09). The finished month is still there, on its own line beneath,
  // with its comparison: never mixed into this month's number.
  const lead = overview?.current ?? null;
  // Last month is the calendar month before this one, even with no receipts:
  // an empty October must read as empty, not be skipped for September (a
  // month of forgotten receipts would otherwise look like restraint). Shown
  // once the family has any finished month with receipts at all.
  const lastMonth = useMemo(() => {
    if (!overview || overview.months.length < 2) return null;
    if (!overview.months.some((m) => m.complete && m.count > 0)) return null;
    return overview.months[overview.months.length - 2];
  }, [overview]);

  const monthName = (key: string) =>
    monthDate(key).toLocaleDateString(locale, { month: 'long' });

  const shopsLabel = (n: number) =>
    n === 1 ? t('exp_shops_one') : t('exp_shops_other', { n });

  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const comparison = overview?.comparison;
  // The average month, over the FINISHED months that have receipts: the month
  // still running would pull it down, and an empty month is more likely
  // forgotten receipts than a month of nothing bought.
  // Two finished months at least: one month alone is that month, not an
  // average.
  const monthAverage = useMemo(() => {
    const done = (overview?.months ?? []).filter((m) => m.complete && m.count > 0);
    if (done.length < 2) return null;
    return { amount: done.reduce((a, m) => a + m.total, 0) / done.length, months: done.length };
  }, [overview]);

  // The months to list, newest first, from the first month that has a
  // receipt: months before the family started would read as forgotten
  // receipts. An empty month AFTER that still shows, as empty.
  const monthsShown = useMemo(() => {
    const months = overview?.months ?? [];
    const first = months.findIndex((m) => m.count > 0);
    return first < 0 ? months.slice(-1) : months.slice(first).reverse();
  }, [overview]);

  const showsComparison = Boolean(comparison && lastMonth && comparison.month === lastMonth.month);
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
      ) : loadFailed && !overview ? (
        <View style={styles.center}><ErrorState onRetry={() => { setLoading(true); load(); }} /></View>
      ) : (
        <Wrapper {...wrapperProps}>

          {/* The two ways in, at the top.

              The add button used to sit at the very bottom — under the summary,
              the chart, "who paid", "where it went" and up to twenty receipt
              rows. On a household with any history that is three screens of
              scrolling, so the primary action of the screen was the least
              reachable thing on it, and it read as missing. */}
          {/* What the last receipt ticked on the shopping list, with the way
              back. Stays until the next scan or "Annuler". */}
          {ticked ? (
            <View testID="exp-ticked-note" style={styles.tickedNote} accessibilityLiveRegion="polite">
              <Check color={ui.mintText} size={18} />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={styles.tickedTitle}>
                  {ticked.shop ? t('exp_ticked_title', { shop: ticked.shop }) : t('exp_ticked_title_noshop')}
                </Text>
                <Text style={styles.tickedBody}>
                  {ticked.items.length === 1
                    ? t('exp_ticked_one', { names: ticked.items[0].name })
                    : t('exp_ticked_n', {
                      n: ticked.items.length,
                      names: ticked.items.slice(0, TICKED_NAMES_SHOWN).map((i) => i.name).join(', ')
                        + (ticked.items.length > TICKED_NAMES_SHOWN ? ', …' : ''),
                    })}
                </Text>
              </View>
              <PressScale
                testID="exp-ticked-undo"
                accessibilityRole="button"
                onPress={undoTicks}
                disabled={undoing}
                style={[styles.tickedUndo, undoing && styles.dim]}
              >
                <Text style={styles.tickedUndoText}>{t('exp_ticked_undo')}</Text>
              </PressScale>
            </View>
          ) : null}

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
          {!scan ? (
            // A digital receipt (PDF from an email or the shop's app), or a
            // picture of one saved in Files: no photo of paper at all.
            <PressScale
              testID="exp-scan-file"
              onPress={importReceiptFile}
              disabled={scanning}
              style={[styles.fileRow, scanning && styles.dim]}
            >
              <FileText color={ui.muted} size={15} />
              <Text style={styles.quietText}>{t('exp_scan_file')}</Text>
            </PressScale>
          ) : null}
          {scanError && !scan ? <Text style={styles.scanErr}>{scanError}</Text> : null}

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

                {/* Every month, in words: what was spent in it and on how many
                    receipts, newest first (Roland, 2026-11-09: "so we know what
                    was spent in that month"). The bars above only show shape. */}
                <View style={styles.monthList} testID="exp-month-list">
                  {monthsShown.map((m) => (
                    <View
                      key={m.month}
                      style={styles.monthRow}
                      testID={`exp-month-${m.month}`}
                      accessible
                      accessibilityLabel={`${capitalise(monthName(m.month))}: ${
                        m.count > 0 ? `${money(m.total)}, ${shopsLabel(m.count)}` : t('exp_month_none')}`}
                    >
                      <Text style={[styles.monthName, !m.complete && styles.colLblNow]}>
                        {capitalise(monthName(m.month))}
                        {!m.complete ? ` · ${t('exp_so_far')}` : ''}
                      </Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.monthAmount}>{m.count > 0 ? money(m.total) : '—'}</Text>
                        <Text style={styles.monthCount}>{m.count > 0 ? shopsLabel(m.count) : t('exp_month_none')}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                {monthAverage ? (
                  <View style={styles.pending} testID="exp-month-average">
                    <Text style={styles.lastMonth}>
                      {t(monthAverage.months === 1 ? 'exp_month_average_one' : 'exp_month_average_n', {
                        amount: money(monthAverage.amount),
                        n: monthAverage.months,
                      })}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.lbl}>
                  {lead ? `${monthName(lead.month)} · ${t('exp_so_far')}` : ''}
                </Text>
                <Text style={styles.big}>{money(lead?.total ?? 0)}</Text>
                {/* How much of the month this number actually covers. Without it,
                    a month where four receipts were forgotten reads as restraint. */}
                <Text style={styles.sub}>{shopsLabel(lead?.count ?? 0)}</Text>

                {lastMonth ? (
                  <View style={styles.pending} testID="exp-last-month">
                    <Text style={styles.lastMonth}>
                      {t('exp_last_month', {
                        month: capitalise(monthName(lastMonth.month)),
                        amount: money(lastMonth.total),
                        count: shopsLabel(lastMonth.count),
                      })}
                    </Text>
                    {showsComparison && comparison ? (
                      meaningful ? (
                        <View style={styles.compareRow}>
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
                        <Text style={styles.compareWhy}>{t('exp_same_usual')}</Text>
                      )
                    ) : (
                      <Text style={styles.compareWhy}>{t('exp_not_enough_yet')}</Text>
                    )}
                  </View>
                ) : (
                  <View style={styles.pending}>
                    <Text style={styles.compareWhy}>{t('exp_not_enough_yet')}</Text>
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
              ) : recent.slice(0, receiptsShown).map((e, i) => (
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
              {recent.length > receiptsShown ? (
                <PressScale
                  testID="receipts-older"
                  accessibilityRole="button"
                  onPress={() => setReceiptsShown((n) => n + RECEIPTS_PAGE)}
                  style={styles.older}
                >
                  <Text style={styles.olderText}>{t('kitchen_show_older')}</Text>
                </PressScale>
              ) : null}
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
              {scan.reconciles === false ? (
                <View style={styles.warn}>
                  <Text style={styles.warnText}>
                    {t('exp_scan_mismatch', {
                      lines: money(scan.lines_total), total: money(scan.total ?? 0),
                    })}
                  </Text>
                </View>
              ) : null}
              {/* No printed total in what was read: the amount is the sum of
                  the lines, said so, and the bottom of the receipt is one
                  photo away. */}
              {scan.total == null ? (
                <View testID="exp-scan-no-total" style={styles.warn}>
                  <Text style={styles.warnText}>{t('exp_scan_no_total', { lines: money(scan.lines_total) })}</Text>
                </View>
              ) : null}
              {(scan.skipped ?? 0) > 0 ? (
                <Text testID="exp-scan-missed" style={styles.hint}>
                  {t('exp_scan_missed', { n: scan.skipped ?? 0 })}
                </Text>
              ) : null}
              {(scan.left_out ?? 0) > 0 ? (
                <Text testID="exp-scan-left-out" style={styles.hint}>
                  {t('exp_scan_left_out', { n: scan.left_out ?? 0 })}
                </Text>
              ) : null}
              {(scan.parts ?? 1) > 1 ? (
                <Text testID="exp-scan-parts" style={styles.hint}>{t('exp_scan_parts', { n: scan.parts ?? 1 })}</Text>
              ) : null}
              {pagesCapped > 0 ? (
                <Text testID="exp-scan-pages-capped" style={styles.hint}>{t('exp_scan_pages_capped', { n: pagesCapped })}</Text>
              ) : null}
              {/* The rest of a receipt too long for one sharp photo. */}
              {/* Said here, by the button, not at the top of a screen the
                  person has scrolled away from. */}
              {scanError ? <Text testID="exp-scan-review-error" style={styles.scanErr}>{scanError}</Text> : null}
              {parts.length > 0 && parts.length < (scan.max_parts ?? RECEIPT_MAX_PARTS) ? (
                <PressScale
                  testID="exp-scan-add-part"
                  onPress={addReceiptPart}
                  disabled={scanning}
                  style={[styles.ghost, scanning && styles.dim]}
                >
                  <Camera color={ui.text} size={16} />
                  <Text style={styles.ghostText}>{scanning ? t('exp_scan_reading') : t('exp_scan_add_part')}</Text>
                </PressScale>
              ) : null}
              {parts.length > 0 && parts.length < (scan.max_parts ?? RECEIPT_MAX_PARTS) ? (
                <Text style={styles.hint}>{t('exp_scan_add_part_hint')}</Text>
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
                        ? (item.unit === 'piece'
                          // "2 × 0,99 €": the count and the price of one, as the ticket prints them.
                          ? `${formatNumber(item.qty, lang)} × ${money(item.unit_price)}`
                          // "1,234 kg · 2,99 €/kg"; grams and millilitres read per kilo and litre.
                          : `${formatNumber(item.qty, lang)} ${UNIT_SHORT[item.unit] ?? item.unit} · ${priceLabel(item.unit_price, item.unit, true, lang)}`)
                        : t('exp_scan_no_unit')}
                      {item.unsure ? ` · ${t('exp_scan_unsure')}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, !keep[i] && styles.rowOff]}>
                    {money(item.line_total)}
                  </Text>
                </PressScale>
              ))}

              {/* The things on the shopping list this receipt shows were bought.
                  Ticked when the receipt is saved, never before, and each one
                  can be unticked here first. */}
              {receiptTicks.length > 0 ? (
                <View testID="exp-tick-box" style={styles.tickBox}>
                  <View style={styles.tickHead}>
                    <ShoppingCart color={ui.mintText} size={17} />
                    <Text style={styles.tickTitle}>{t('exp_tick_title')}</Text>
                  </View>
                  <Text style={styles.tickSub}>{t('exp_tick_sub')}</Text>
                  {receiptTicks.map((m) => {
                    const on = !untick.has(m.item.item_id);
                    const name = splitQuantity(m.item.name).label;
                    return (
                      <PressScale
                        key={m.item.item_id}
                        testID={`exp-tick-${m.item.item_id}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={t('exp_tick_row', { item: name, line: m.line })}
                        onPress={() => setUntick((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.item.item_id)) next.delete(m.item.item_id); else next.add(m.item.item_id);
                          return next;
                        })}
                        style={styles.tickRow}
                      >
                        <View style={[styles.tickBoxMark, on && styles.tickBoxMarkOn]}>
                          {on ? <Check color={ui.doneTick} size={13} /> : null}
                        </View>
                        <Text style={[styles.tickItem, !on && styles.rowOff]} numberOfLines={1}>{name}</Text>
                        <Text style={styles.tickLine} numberOfLines={1}>← {m.line}</Text>
                      </PressScale>
                    );
                  })}
                </View>
              ) : null}

              <PressScale
                testID="exp-scan-save"
                onPress={saveScanned}
                disabled={saving}
                style={[styles.primary, saving && styles.dim]}
              >
                <Text style={styles.primaryText}>
                  {saving
                    ? t('exp_saving')
                    : toTick.length === 0
                      ? t('exp_save')
                      : toTick.length === 1
                        ? t('exp_save_tick_one')
                        : t('exp_save_tick_n', { n: toTick.length })}
                </Text>
              </PressScale>
              <PressScale onPress={() => { setScan(null); setKeep([]); setParts([]); setPagesCapped(0); }} style={styles.quiet}>
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
  segText: { fontFamily: 'Figtree_700Bold', fontSize: 13, color: ui.muted },
  segTextOn: { color: ui.text },

  card: {
    backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
    borderRadius: 16, padding: 14, gap: 10,
  },
  lbl: {
    fontFamily: 'Figtree_700Bold', fontSize: 11, letterSpacing: 0.6,
    textTransform: 'uppercase', color: ui.muted,
  },
  big: { fontFamily: 'Figtree_800ExtraBold', fontSize: 36, color: ui.text, marginTop: -4 },
  sub: { fontFamily: 'Figtree_500Medium', fontSize: 12.5, color: ui.muted, marginTop: -6 },

  compare: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: ui.orangeSoft, borderRadius: 12, padding: 10,
  },
  compareText: { fontFamily: 'Figtree_700Bold', fontSize: 13, color: ui.orangeDeep },
  compareGood: { color: ui.mintText },
  compareWhy: { fontFamily: 'Figtree_500Medium', fontSize: 11.5, color: ui.muted, marginTop: 2 },
  pending: { backgroundColor: ui.soft, borderRadius: 12, padding: 10, gap: 4 },
  lastMonth: { fontFamily: 'Figtree_700Bold', fontSize: 13.5, color: ui.text },
  compareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 2 },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 96, marginTop: 4 },
  monthList: { marginTop: 6 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: ui.line },
  monthName: { fontFamily: 'Figtree_700Bold', fontSize: 14.5, color: ui.text, flex: 1 },
  monthAmount: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.text },
  monthCount: { fontFamily: 'Figtree_500Medium', fontSize: 12, color: ui.muted },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  stick: { width: '100%', borderRadius: 6, backgroundColor: ui.orangeSoft, minHeight: 3 },
  stickNow: { backgroundColor: ui.orange },
  colLbl: { fontFamily: 'Figtree_600SemiBold', fontSize: 10, color: ui.muted },
  colLblNow: { color: ui.orangeText },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: ui.line, paddingTop: 10, marginTop: 2 },
  shopCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: ui.soft,
    alignItems: 'center', justifyContent: 'center',
  },
  markText: { fontFamily: 'Figtree_700Bold', fontSize: 12, color: ui.muted },
  shopName: { fontFamily: 'Figtree_600SemiBold', fontSize: 14.5, color: ui.text },
  shopSub: { fontFamily: 'Figtree_500Medium', fontSize: 11.5, color: ui.muted },
  rowAmount: { fontFamily: 'Figtree_700Bold', fontSize: 14.5, color: ui.text },
  del: { padding: 4 },

  empty: { fontFamily: 'Figtree_500Medium', fontSize: 13, color: ui.muted, paddingVertical: 6 },

  input: {
    minHeight: 46, borderRadius: 12, backgroundColor: ui.soft,
    borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14,
    fontFamily: 'Figtree_500Medium', fontSize: 15, color: ui.text,
  },
  hint: { fontFamily: 'Figtree_500Medium', fontSize: 11.5, color: ui.muted, marginTop: -4 },

  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 14,
  },
  primaryText: { fontFamily: 'Figtree_700Bold', fontSize: 15, color: '#fff' },
  dim: { opacity: 0.6 },
  settleCard: { borderColor: ui.lavenderText, borderWidth: 1 },
  settleHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settleTitle: { flex: 1, color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 17, lineHeight: 23, letterSpacing: -0.2 },
  settleNote: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  settleBtn: { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: ui.lavenderText },
  settleBtnText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 14 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, marginBottom: 6 },
  splitLabel: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
  splitSub: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12, marginTop: 2 },
  quiet: { alignItems: 'center', paddingVertical: 10 },
  fileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionHalf: { flex: 1, marginTop: 0 },
  ghost: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
    borderRadius: 14, paddingVertical: 14,
  },
  ghostText: { fontFamily: 'Figtree_600SemiBold', fontSize: 14, color: ui.text },
  scanErr: { fontFamily: 'Figtree_500Medium', fontSize: 12.5, color: ui.danger },
  warn: { backgroundColor: ui.orangeSoft, borderRadius: 12, padding: 10 },
  warnText: { fontFamily: 'Figtree_500Medium', fontSize: 12.5, color: ui.orangeText },
  tick: {
    width: 18, height: 18, borderRadius: 5, marginRight: 10,
    borderWidth: 1.5, borderColor: ui.line,
  },
  tickOn: { backgroundColor: ui.orange, borderColor: ui.orange },
  // "On your shopping list", in the receipt review.
  tickBox: {
    backgroundColor: ui.mint, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 6,
  },
  tickHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tickTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 14, color: ui.mintText },
  tickSub: { fontFamily: 'Figtree_500Medium', fontSize: 12.5, lineHeight: 17, color: ui.text },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, minHeight: 36 },
  tickBoxMark: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: ui.checkLine,
    alignItems: 'center', justifyContent: 'center',
  },
  tickBoxMarkOn: { backgroundColor: ui.doneFill, borderColor: ui.doneFill },
  tickItem: { fontFamily: 'Figtree_700Bold', fontSize: 15, color: ui.text, flexShrink: 0, maxWidth: '45%' },
  tickLine: { flex: 1, fontFamily: 'Figtree_500Medium', fontSize: 12.5, color: ui.muted, textAlign: 'right' },
  // After saving: what was ticked, with the way back.
  tickedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: ui.mint,
    borderRadius: 14, padding: 12,
  },
  tickedTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 14.5, color: ui.text },
  tickedBody: { fontFamily: 'Figtree_500Medium', fontSize: 13, lineHeight: 18, color: ui.text },
  tickedUndo: {
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: ui.line,
    backgroundColor: ui.card, minHeight: 32, justifyContent: 'center',
  },
  tickedUndoText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 13, color: ui.text },
  rowOff: { color: ui.muted, textDecorationLine: 'line-through' },
  quietText: { fontFamily: 'Figtree_600SemiBold', fontSize: 14, color: ui.muted },
  older: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: ui.soft },
  olderText: { fontFamily: 'Figtree_600SemiBold', fontSize: 13, color: ui.orangeText },
});
