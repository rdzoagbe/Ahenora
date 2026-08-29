import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, StyleSheet, TextInput, ScrollView, ActivityIndicator, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Plus, X, Trash2, ShoppingCart, Check, UtensilsCrossed, ChevronLeft, History, RotateCcw, Sparkles, Sun, ChefHat, Clock, AlertTriangle, Search, Minus, Camera, Image as ImageIcon , ListChecks, Leaf, Shuffle} from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { SpendingView } from '../../src/components/SpendingView';
import { PressScale } from '../../src/components/PressScale';
import { KeyboardAwareScrollView } from '../../src/components/KeyboardAwareScrollView';
import { WindowedList } from '../../src/components/WindowedList';
import { localeFor } from '../../src/utils/date';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast from '../../src/components/AppToast';
import { useToast } from '../../src/hooks/useToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { ScreenHeader, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, MealPlan, ShoppingItem, ShoppingHistoryEntry, SavedMealPlan, Diet, AiRecipe,
  FrequentItem, PriceCompare } from '../../src/api';
import { usePremiumGate, LockBadge, PremiumPreviewBanner } from '../../src/components/PremiumGate';
import { logger } from '../../src/logger';
import { suggestWeek, MealSuggestion, SuggestLang, localizedMealTitle, localizedMealIngredients, resolveRecipeId, recipeIngredients, searchRecipes } from '../../src/mealSuggestions';
import { quantityFor, shoppingNameFor, formatAiQuantity, AiIngredient } from '../../src/recipeQuantities';
import { categoriseShoppingItem } from '../../src/shoppingCategories';
import { recipeMethod } from '../../src/recipeSteps';

type KitchenView = 'shop' | 'meal' | 'spend';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Translate a stored shopping category label. Known categories map to an i18n
// key (shopcat_*); anything the user set themselves falls back to the raw text,
// since t() returns the key unchanged when there's no translation.
function catLabel(cat: string, t: (k: string) => string): string {
  const key = 'shopcat_' + cat.toLowerCase().replace(/\s+/g, '_');
  const val = t(key);
  return val === key ? cat : val;
}

const KEEP_AWAKE_TAG = 'kitchen-screen';
const KEEP_AWAKE_KEY = 'coo_keep_screen_on';

export default function Kitchen() {
  const { t, lang, subscription, dataVersion } = useStore();
  // The food library covers en/es/fr/de; anything else falls back to English.
  // How many people the amounts are scaled for. Defaults to the household and
  // is adjustable, because who is actually eating changes night to night.
  // Derived, not stored: show the household we know about until the user says
  // otherwise, since who is eating tonight is not always everyone. Deriving
  // avoids an effect that would fight the user's choice whenever the
  // subscription refreshed.
  const [servingsOverride, setServingsOverride] = useState<number | null>(null);
  const servings = servingsOverride ?? Math.max(1, Math.min(12, subscription?.members_count || 4));
  const setServings = setServingsOverride;
  const [showBrowse, setShowBrowse] = useState(false);
  const [browseQuery, setBrowseQuery] = useState('');
  const [browseDay, setBrowseDay] = useState('monday');
  // Generated methods held for this session, keyed by meal id. The server
  // caches them too; this just avoids a round trip while the sheet is open.
  const [aiRecipes, setAiRecipes] = useState<Record<string, { minutes: number; steps: string[]; servings?: number; ingredients?: AiIngredient[] }>>({});
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  // The diet and variant of the recipe currently on screen, and whether a
  // rewrite/regenerate is in flight. A vegetarian rewrite really re-cooks the
  // ingredients and steps, so this drives the badge and which action shows.
  const [recipeDiet, setRecipeDiet] = useState<Diet>('');
  const [recipeVariant, setRecipeVariant] = useState(0);
  const [regenBusy, setRegenBusy] = useState(false);
  // The household's cooking diet. Vegetarian makes new recipes and the weekly
  // suggestions come out vegetarian without asking each time.
  const [householdDiet, setHouseholdDiet] = useState<Diet>('');
  // Recipe currently open full-screen. addToDay marks a preview opened from
  // the browser: the page then carries an "add to that day" action, so a
  // parent reads the recipe before committing it to the week.
  const [cookingRecipe, setCookingRecipe] = useState<{ recipeId: string | null; mealId?: string; title: string; addToDay?: string; adHoc?: AiRecipe } | null>(null);
  // "Ask the AI for a recipe": a free-text dish, generated on the spot without
  // a plan entry. The result opens in the same full-screen recipe view.
  const [recipeAiQuery, setRecipeAiQuery] = useState('');
  const [recipeAiBusy, setRecipeAiBusy] = useState(false);
  const suggestLang = useMemo<SuggestLang>(
    () => (['en', 'es', 'fr', 'de'].includes(lang) ? (lang as SuggestLang) : 'en'),
    [lang],
  );
  const { isLocked, promptUpgrade } = usePremiumGate();
  const mealLocked = isLocked('meal_planner');
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [view, setView] = useState<KitchenView>('shop');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast, showToast } = useToast();

  const [shopItems, setShopItems] = useState<ShoppingItem[]>([]);
  const [shopInput, setShopInput] = useState('');
  const [addingShop, setAddingShop] = useState(false);

  const [meals, setMeals] = useState<MealPlan[]>([]);
  const mealSavingRef = useRef(false);
  const [mealDay, setMealDay] = useState('monday');
  const [mealTitle, setMealTitle] = useState('');
  const [mealIngredients, setMealIngredients] = useState('');
  const [showMealAdd, setShowMealAdd] = useState(false);

  const [showShopHistory, setShowShopHistory] = useState(false);
  const [shopHistory, setShopHistory] = useState<ShoppingHistoryEntry[]>([]);
  // The household's regulars — items bought often on past trips, not on the
  // list right now. Tap one to add it back without typing.
  const [regulars, setRegulars] = useState<FrequentItem[]>([]);
  const [showMealHistory, setShowMealHistory] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedMealPlan[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [savePlanName, setSavePlanName] = useState('');
  const [restoreEntry, setRestoreEntry] = useState<ShoppingHistoryEntry | null>(null);
  const [restoreSel, setRestoreSel] = useState<Set<number>>(new Set());
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestFellBack, setSuggestFellBack] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestVariant, setSuggestVariant] = useState(0);
  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);
  const [addedSuggest, setAddedSuggest] = useState<Set<string>>(new Set());


  const load = useCallback(async () => {
    try {
      const [shopRes, mealRes, histRes, dietRes, freqRes] = await Promise.allSettled([
        api.listShopping(), api.listMeals(), api.listShoppingHistory(), api.getMealDiet(),
        api.listFrequentShopping(),
      ]);
      if (shopRes.status === 'fulfilled') setShopItems(shopRes.value);
      if (mealRes.status === 'fulfilled') setMeals(mealRes.value);
      if (histRes.status === 'fulfilled') setShopHistory(histRes.value);
      if (dietRes.status === 'fulfilled') setHouseholdDiet(dietRes.value.diet);
      if (freqRes.status === 'fulfilled') setRegulars(freqRes.value.items);
      // If every request failed (offline / server down), the empty states would
      // otherwise read as "your kitchen is empty" — say it failed instead.
      if ([shopRes, mealRes, histRes, dietRes].every((r) => r.status === 'rejected')) {
        showToast(t('load_failed_pull'), 'error');
      }
    } catch (e: any) {
      logger.warn('Kitchen load failed:', e?.message || e);
      showToast(t('load_failed_pull'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Reload in place after a capture from the global "+".
  useEffect(() => {
    if (dataVersion) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Keep the screen awake while shopping / following a recipe — the phone
  // shouldn't dim mid-aisle or on step 3. On by default; a toggle lets users
  // opt out (persisted). Only held while the Kitchen tab is focused, so it
  // never drains battery elsewhere.
  const [keepAwake, setKeepAwake] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(KEEP_AWAKE_KEY)
      .then((v) => { if (v === '0') setKeepAwake(false); })
      .catch(() => undefined);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (keepAwake) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined); };
    }, [keepAwake]),
  );
  const toggleKeepAwake = useCallback(() => {
    setKeepAwake((prev) => {
      const next = !prev;
      AsyncStorage.setItem(KEEP_AWAKE_KEY, next ? '1' : '0').catch(() => undefined);
      if (next) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      return next;
    });
  }, []);

  // ── Snap a paper shopping list into items ──
  // The photo never adds anything directly: the scan returns candidates, the
  // sheet shows them ticked (unsure reads unticked), and only the confirmed
  // selection goes through the ordinary bulk add.
  const [showScan, setShowScan] = useState(false);
  const [scanPhase, setScanPhase] = useState<'idle' | 'reading' | 'review'>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanItems, setScanItems] = useState<{ name: string; unsure: boolean; checked: boolean }[]>([]);
  const [scanAdding, setScanAdding] = useState(false);

  const openScan = useCallback(() => {
    setScanPhase('idle');
    setScanError(null);
    setScanItems([]);
    setShowScan(true);
  }, []);

  const pickScan = useCallback(async (source: 'camera' | 'library') => {
    setScanError(null);
    try {
      if (Platform.OS !== 'web') {
        if (source === 'camera') {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p.granted) throw new Error(t('cam_camera_permission_denied'));
        } else {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) throw new Error(t('cam_gallery_permission_denied'));
        }
      }
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.55, mediaTypes: ImagePicker.MediaTypeOptions.Images })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.55, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (res.canceled || !res.assets?.[0]) return;
      // Native supplies base64 directly; web supplies a data URL instead.
      const asset = res.assets[0];
      const base64 = asset.base64 ?? (asset.uri?.startsWith('data:') ? asset.uri.split(',')[1] : null);
      if (!base64) return;

      setScanPhase('reading');
      const { items } = await api.scanShoppingList(base64);
      setScanItems(items.map((i) => ({ ...i, checked: !i.unsure })));
      setScanPhase('review');
    } catch (e: any) {
      setScanPhase('idle');
      setScanError(e?.message || t('scan_failed'));
    }
  }, [t]);

  const toggleScanItem = useCallback((idx: number) => {
    setScanItems((prev) => prev.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)));
  }, []);

  // Snapping this week's paper list usually means REPLACING last week's,
  // not appending to it — offered right where the decision is made.
  const [scanReplace, setScanReplace] = useState(false);

  // What the household's own receipts say each thing costs, per shop. Loaded
  // once with the list because the moment it is worth knowing is BEFORE the
  // trip — a saving reported afterwards is a post-mortem.
  const [prices, setPrices] = useState<PriceCompare | null>(null);
  useEffect(() => {
    api.getPriceCompare().then(setPrices).catch(() => setPrices(null));
  }, [dataVersion]);

  // Item name -> the cheaper shop, when the receipts can honestly say. The
  // server has already refused anything thin: one visit, mismatched units,
  // stale prices. So anything here is safe to show.
  const cheaperBy = useMemo(() => {
    const out = new Map<string, { shop: string; saving: number; unit: string }>();
    (prices?.comparable ?? []).forEach((row) => {
      if (!row.saving) return;
      out.set(row.name_key, {
        shop: row.cheapest, saving: row.saving.per_unit, unit: row.unit,
      });
    });
    return out;
  }, [prices]);

  const addScannedItems = useCallback(async () => {
    const picked = scanItems.filter((i) => i.checked).map((i) => i.name);
    if (picked.length === 0 || scanAdding) return;
    setScanAdding(true);
    try {
      if (scanReplace) await api.clearAllShopping();
      await api.bulkAddShopping(picked, picked.map((n) => categoriseShoppingItem(n) || undefined));
      setShopItems(await api.listShopping().catch(() => []));
      setShowScan(false);
      setScanReplace(false);
      showToast(t('cook_added_to_list', { n: picked.length }), 'success');
    } catch {
      showToast(t('vault_could_not_add_meal'), 'error');
    } finally {
      setScanAdding(false);
    }
  }, [scanItems, scanAdding, scanReplace, showToast, t]);

  // ── Capture a printed recipe into the planner ──
  // Same posture as the list scan: the photo produces a reviewable recipe,
  // and committing it re-validates everything server-side.
  type Captured = { title: string; minutes: number; servings: number; ingredients: AiIngredient[]; steps: string[] };
  const [showCapture, setShowCapture] = useState(false);
  const [capturePhase, setCapturePhase] = useState<'idle' | 'reading' | 'review'>('idle');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [captureDay, setCaptureDay] = useState('monday');
  const [captureAdding, setCaptureAdding] = useState(false);

  const openCapture = useCallback(() => {
    setCapturePhase('idle');
    setCaptureError(null);
    setCaptured(null);
    setShowCapture(true);
  }, []);

  const pickCapture = useCallback(async (source: 'camera' | 'library') => {
    setCaptureError(null);
    try {
      if (Platform.OS !== 'web') {
        if (source === 'camera') {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p.granted) throw new Error(t('cam_camera_permission_denied'));
        } else {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) throw new Error(t('cam_gallery_permission_denied'));
        }
      }
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.55, mediaTypes: ImagePicker.MediaTypeOptions.Images })
        : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.55, mediaTypes: ImagePicker.MediaTypeOptions.Images });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const base64 = asset.base64 ?? (asset.uri?.startsWith('data:') ? asset.uri.split(',')[1] : null);
      if (!base64) return;

      setCapturePhase('reading');
      const { captured: recipe } = await api.captureRecipe(base64);
      setCaptured(recipe);
      setCapturePhase('review');
    } catch (e: any) {
      setCapturePhase('idle');
      setCaptureError(e?.message || t('capture_failed'));
    }
  }, [t]);

  const addCapturedMeal = useCallback(async () => {
    if (!captured || captureAdding) return;
    setCaptureAdding(true);
    try {
      const created = await api.addMealFromCapture(captureDay, captured, suggestLang);
      setMeals((prev) => [...prev, created]);
      setShowCapture(false);
      showToast(`1 ${t('kitchen_meals_added')}`, 'success');
    } catch (e: any) {
      showToast(e?.message || t('vault_could_not_add_meal'), 'error');
    } finally {
      setCaptureAdding(false);
    }
  }, [captured, captureAdding, captureDay, suggestLang, showToast, t]);

  const addShopItem = useCallback(async () => {
    // "milk, eggs, bread" (or one per line) adds them all in one tap.
    const names = shopInput.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    setAddingShop(true);
    try {
      if (names.length === 1) {
        const item = await api.addShoppingItem({ name: names[0], category: categoriseShoppingItem(names[0]) || undefined });
        setShopItems((prev) => [item, ...prev]);
      } else {
        const r = await api.bulkAddShopping(names, names.map((n) => categoriseShoppingItem(n) || undefined));
        setShopItems(await api.listShopping().catch(() => []));
        showToast(`${r.added} ${t('vault_ingredients_added_to_list')}`, 'success');
      }
      setShopInput('');
    } catch {
      showToast(t('vault_could_not_add_item'), 'error');
    } finally {
      setAddingShop(false);
    }
  }, [shopInput, showToast]);

  // Add a regular back to the list in one tap. Drop it from the row straight
  // away so it feels instant, and it stays gone because it is now on the list.
  const addRegular = useCallback(async (name: string) => {
    setRegulars((prev) => prev.filter((r) => r.name !== name));
    try {
      const item = await api.addShoppingItem({ name, category: categoriseShoppingItem(name) || undefined });
      setShopItems((prev) => [item, ...prev]);
    } catch {
      showToast(t('vault_could_not_add_item'), 'error');
      setRegulars(await api.listFrequentShopping().then((r) => r.items).catch(() => []));
    }
  }, [showToast, t]);

  const toggleShopItem = useCallback(async (item: ShoppingItem) => {
    setShopItems((prev) => prev.map((i) => i.item_id === item.item_id ? { ...i, checked: !i.checked } : i));
    try {
      await api.updateShoppingItem(item.item_id, { checked: !item.checked });
    } catch {
      showToast(t('vault_could_not_update'), 'error');
      load();
    }
  }, [load, showToast]);

  const deleteShopItem = useCallback(async (itemId: string) => {
    setShopItems((prev) => prev.filter((i) => i.item_id !== itemId));
    try {
      await api.deleteShoppingItem(itemId);
    } catch {
      showToast(t('vault_could_not_delete_restored'), 'error');
      load();
    }
  }, [load, showToast]);

  // Multi-select: pick a few items and delete just those, instead of the
  // all-or-nothing "clear the whole list". Plain functions — a manual
  // useCallback here makes the React Compiler skip the whole screen.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setShopItems((prev) => prev.filter((i) => !selectedIds.has(i.item_id)));
    exitSelect();
    try {
      await Promise.all(ids.map((id) => api.deleteShoppingItem(id)));
      showToast(`${ids.length} ${t('kitchen_items_removed')}`, 'success');
    } catch {
      showToast(t('vault_could_not_delete_restored'), 'error');
      load();
    }
  };

  const clearChecked = useCallback(async () => {
    const checkedIds = new Set(shopItems.filter((i) => i.checked).map((i) => i.item_id));
    if (checkedIds.size === 0) return;
    setShopItems((prev) => prev.filter((i) => !checkedIds.has(i.item_id)));
    try {
      await api.clearCheckedShopping();
    } catch {
      showToast(t('vault_could_not_clear_restored'), 'error');
      load();
    }
  }, [shopItems, load, showToast]);

  const clearAllShop = useCallback(() => {
    if (shopItems.length === 0) return;
    // Clearing the list is the "new week" gesture, so the meal plan built from
    // it goes stale at the same moment. Save it for reuse, then clear the
    // planner alongside the list — but only mention that when there is a plan.
    const hasPlan = meals.length > 0;
    Alert.alert(
      t('kitchen_clear_shop_q'),
      hasPlan ? t('kitchen_clear_shop_plan_body') : t('kitchen_clear_shop_body'),
      [
        { text: t('vault_cancel'), style: 'cancel' },
        {
          text: t('kitchen_clear_all'),
          style: 'destructive',
          onPress: async () => {
            setShopItems([]);
            const clearedMeals = meals;
            if (hasPlan) setMeals([]);
            try {
              await api.clearAllShopping();
              let planSaved = false;
              if (hasPlan) {
                // Snapshot the current plan under a dated name, then clear it.
                // saveMealPlan reads the live meals server-side, so save before
                // clearing.
                const dated = t('kitchen_auto_plan_name', {
                  date: new Date().toLocaleDateString(localeFor(lang)),
                });
                planSaved = await api
                  .saveMealPlan(dated)
                  .then(() => true)
                  .catch(() => false);
                // Only clear the planner if the plan was safely saved. If the
                // save failed, keep the meals rather than deleting them unsaved.
                if (planSaved) {
                  await api.clearAllMeals();
                  setSavedPlans(await api.listSavedPlans().catch(() => savedPlans));
                } else {
                  // Put the optimistically-cleared meals back on screen.
                  setMeals(clearedMeals);
                }
              }
              setShopHistory(await api.listShoppingHistory().catch(() => []));
              // Only promise the plan was saved when it really was; if a plan
              // existed but couldn't be saved, it's been kept, not lost.
              showToast(
                hasPlan && planSaved
                  ? t('kitchen_shop_cleared_plan_saved')
                  : hasPlan
                    ? t('kitchen_shop_cleared_plan_kept')
                    : t('kitchen_cleared'),
                'success',
              );
            } catch {
              showToast(t('vault_could_not_update'), 'error');
              if (hasPlan) setMeals(clearedMeals);
              load();
            }
          },
        },
      ],
    );
  }, [shopItems.length, meals, savedPlans, load, showToast, t]);

  const clearAllMealsPlan = useCallback(() => {
    if (meals.length === 0) return;
    Alert.alert(t('kitchen_clear_meal_q'), t('kitchen_clear_meal_body'), [
      { text: t('vault_cancel'), style: 'cancel' },
      {
        text: t('kitchen_clear_all'),
        style: 'destructive',
        onPress: async () => {
          setMeals([]);
          try {
            await api.clearAllMeals();
            showToast(t('kitchen_cleared'), 'success');
          } catch {
            showToast(t('vault_could_not_update'), 'error');
            load();
          }
        },
      },
    ]);
  }, [meals.length, load, showToast, t]);

  const addMeal = useCallback(async () => {
    if (!mealTitle.trim()) return;
    if (mealSavingRef.current) return;
    mealSavingRef.current = true;
    try {
      const ingredients = mealIngredients.split(',').map((s) => s.trim()).filter(Boolean);
      const created = await api.createMeal({ day: mealDay, title: mealTitle.trim(), ingredients });
      setMeals((prev) => [...prev, created]);
      setMealTitle('');
      setMealIngredients('');
      setShowMealAdd(false);
      showToast(t('vault_meal_added'), 'success');
    } catch {
      showToast(t('vault_could_not_add_meal'), 'error');
    } finally {
      mealSavingRef.current = false;
    }
  }, [mealDay, mealTitle, mealIngredients, showToast]);

  const deleteMeal = useCallback(async (id: string) => {
    setMeals((prev) => prev.filter((m) => m.meal_id !== id));
    try { await api.deleteMeal(id); } catch { showToast(t('vault_could_not_delete_restored'), 'error'); load(); }
  }, [load, showToast]);

  const syncMealsToShopping = useCallback(async () => {
    try {
      const res = await api.syncMealsToShopping();
      showToast(`${res.added} ${t('vault_ingredients_added_to_list')}`, 'success');
      const shopRes = await api.listShopping().catch(() => []);
      setShopItems(shopRes);
    } catch {
      showToast(t('vault_could_not_sync'), 'error');
    }
  }, [showToast]);

  // ── Suggest a week of meals from what you've bought (rule-based, offline) ──
  // A suggestion's identity is the dish, not the weekday it landed on. Keying
  // the "added" flag on the day meant that after "Different ideas" swapped the
  // dishes, a day still read "Added" beside a dish that was never added, and
  // Add-all silently skipped it. recipeId for library dishes, title for AI ones.
  const sugKey = useCallback(
    (s: MealSuggestion) => `${s.recipeId ?? ''}|${s.title}`,
    [],
  );

  // The offline engine ranks the built-in library and always returns the same
  // week for the same list. Kept as the fallback: it works with no signal, no
  // quota and no key, so a failure downgrades rather than empties the screen.
  const localWeek = useCallback(
    (variant = 0) =>
      suggestWeek(
        shopItems.map((i) => i.name),
        suggestLang,
        shopHistory.slice(0, 6).flatMap((h) => h.items),
        variant,
      ),
    [shopItems, shopHistory, suggestLang],
  );

  const loadSuggestions = useCallback(async (variant = 0) => {
    setSuggestLoading(true);
    setSuggestFellBack(false);
    setSuggestError(null);
    // Clear the previous week rather than leaving it on screen while the AI
    // thinks. Stale rows under a "planning" spinner read as "same ideas
    // again" — which is exactly what a user reported. An honest empty
    // planning state, then the new week arrives all at once.
    setSuggestions([]);
    try {
      const { meals } = await api.suggestMealsAI(suggestLang, variant);
      setSuggestions(
        meals.map((m) => ({
          day: m.day,
          recipeId: null,
          title: m.title,
          haveLabels: m.uses,
          needLabels: m.need,
          allLabels: [...m.uses, ...m.need],
          matched: m.uses.length,
        })),
      );
    } catch (e: any) {
      // Locked plan, spent quota, no signal, or a response the gate rejected.
      // Which one matters: "add more to your list" and "the planner is down"
      // need different things from the user, and a single vague line taught us
      // nothing when this failed in the field.
      const status = e?.status;
      setSuggestions(localWeek(variant));
      setSuggestFellBack(true);
      setSuggestError(
        status === 404 ? t('kitchen_ai_not_deployed')
        : status === 422 ? t('kitchen_ai_list_too_short')
        : status === 402 ? t('kitchen_ai_limit')
        : status === 503 ? t('kitchen_ai_unavailable')
        : null,
      );
    } finally {
      setSuggestLoading(false);
    }
  }, [suggestLang, localWeek, t]);

  const openSuggest = useCallback(() => {
    // Meal ideas are built FROM the shopping list. With nothing (or nearly
    // nothing) on it, both engines would only be guessing — the offline one
    // pads the week with staples and the AI one used to lean on old history —
    // so the honest behaviour is to ask for a list first, not to invent one.
    if (shopItems.length < 3) {
      showToast(t('kitchen_suggest_need_items'), 'info');
      return;
    }
    setAddedSuggest(new Set());
    setSuggestVariant(0);
    setShowSuggest(true);
    loadSuggestions(0);
  }, [shopItems.length, loadSuggestions, showToast, t]);

  // "Different ideas" must change something even when the AI planner is
  // unreachable, which is exactly when a repeated week is most annoying.
  const askAgain = useCallback(() => {
    const next = suggestVariant + 1;
    setSuggestVariant(next);
    // The dishes are about to change wholesale; drop the added-flags so none
    // are left pointing at a dish that is no longer on screen.
    setAddedSuggest(new Set());
    loadSuggestions(next);
  }, [suggestVariant, loadSuggestions]);

  const acceptSuggestion = useCallback(async (sug: MealSuggestion) => {
    // Close the sheet first: on web the root upgrade dialog stacks BELOW an
    // open sheet, so prompting under it looked like nothing happened.
    if (mealLocked) { setShowSuggest(false); promptUpgrade('meal_planner'); return; }
    const key = sugKey(sug);
    if (addedSuggest.has(key)) return;
    setAddedSuggest((prev) => new Set(prev).add(key));
    try {
      const created = await api.createMeal({
        day: sug.day,
        title: sug.title,
        ingredients: sug.allLabels,
        recipe_id: sug.recipeId || undefined,
      });
      setMeals((prev) => [...prev, created]);
    } catch {
      setAddedSuggest((prev) => { const n = new Set(prev); n.delete(key); return n; });
      showToast(t('vault_could_not_add_meal'), 'error');
    }
  }, [addedSuggest, mealLocked, promptUpgrade, showToast, t, sugKey]);

  const acceptAllSuggestions = useCallback(async () => {
    if (mealLocked) { setShowSuggest(false); promptUpgrade('meal_planner'); return; }
    // Only fill days that don't already have a meal, so we never clobber a plan.
    const busyDays = new Set(meals.map((m) => m.day));
    const toAdd = suggestions.filter((s) => !addedSuggest.has(sugKey(s)) && !busyDays.has(s.day));
    if (toAdd.length === 0) { setShowSuggest(false); return; }
    setAddedSuggest((prev) => { const n = new Set(prev); toAdd.forEach((s) => n.add(sugKey(s))); return n; });
    try {
      const created = await Promise.all(
        toAdd.map((s) => api.createMeal({
          day: s.day,
          title: s.title,
          ingredients: s.allLabels,
          recipe_id: s.recipeId || undefined,
        })),
      );
      setMeals((prev) => [...prev, ...created]);
      setShowSuggest(false);
      showToast(`${created.length} ${t('kitchen_meals_added')}`, 'success');
    } catch {
      // The batch failed as a whole — un-mark the rows so they read as
      // addable again rather than a lying green check.
      setAddedSuggest((prev) => {
        const n = new Set(prev);
        toAdd.forEach((s) => n.delete(sugKey(s)));
        return n;
      });
      setMeals(await api.listMeals().catch(() => []));
      showToast(t('vault_could_not_add_meal'), 'error');
    }
  }, [suggestions, addedSuggest, meals, mealLocked, promptUpgrade, showToast, t, sugKey]);

  // "Ask the chef" on the recipe page: one bounded question, one short
  // validated answer. State lives here so it clears with the page.
  const [chefQuestion, setChefQuestion] = useState('');
  const [chefAnswer, setChefAnswer] = useState<string | null>(null);
  const [chefBusy, setChefBusy] = useState(false);

  // Every way onto the recipe page goes through here, so a fresh recipe
  // never inherits the previous one's chef conversation.
  const openRecipe = useCallback((next: { recipeId: string | null; mealId?: string; title: string; addToDay?: string }) => {
    setChefQuestion('');
    setChefAnswer(null);
    setCookingRecipe(next);
  }, []);

  const askChef = useCallback(async (q: string) => {
    if (!cookingRecipe || chefBusy) return;
    const question = q.trim();
    if (question.length < 5) return;
    setChefBusy(true);
    setChefAnswer(null);
    try {
      const { answer } = await api.askChef(cookingRecipe.title, question, suggestLang);
      setChefAnswer(answer);
    } catch (e: any) {
      showToast(e?.message || t('chef_failed'), 'error');
    } finally {
      setChefBusy(false);
    }
  }, [cookingRecipe, chefBusy, suggestLang, showToast, t]);

  const addMissingToList = useCallback(async (recipeId: string) => {
    const needed = recipeIngredients(recipeId, suggestLang);
    // The list stores amount-prefixed names ("600 g chicken"), so an exact
    // match on the bare label ("chicken") never fires and a second tap
    // duplicated the whole recipe. Match on whether the ingredient word already
    // appears in any list item instead.
    const listWords = shopItems.map(
      (i) => ` ${i.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `,
    );
    const alreadyHave = (label: string) => {
      const l = label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      return listWords.some((n) => n.includes(` ${l} `));
    };
    const missing = needed.filter((n) => !alreadyHave(n.label));

    if (missing.length === 0) {
      showToast(t('cook_nothing_missing'), 'info');
      return;
    }

    try {
      // The amount goes on the list too — "400 g rice" is what you need at the
      // shop. Seasonings ("curry", "basil") go on bare, without "to taste".
      const created = await Promise.all(
        missing.map((m) => {
          const name = shoppingNameFor(m.id, m.label, servings, suggestLang);
          return api.addShoppingItem({ name, category: categoriseShoppingItem(name) || undefined });
        }),
      );
      setShopItems((prev) => [...prev, ...created]);
      showToast(t('cook_added_to_list', { n: created.length }), 'success');
    } catch {
      setShopItems(await api.listShopping().catch(() => []));
      showToast(t('vault_could_not_add_meal'), 'error');
    }
  }, [shopItems, servings, suggestLang, showToast, t]);

  const addRecipeToDay = useCallback(async (recipeId: string, title: string, day: string) => {
    if (mealLocked) { setShowBrowse(false); promptUpgrade('meal_planner'); return; }
    try {
      const created = await api.createMeal({
        day,
        title,
        ingredients: recipeIngredients(recipeId, suggestLang).map((i) => i.label),
        recipe_id: recipeId,
      });
      setMeals((prev) => [...prev, created]);
      setShowBrowse(false);
      setBrowseQuery('');
      showToast(`1 ${t('kitchen_meals_added')}`, 'success');
    } catch {
      showToast(t('vault_could_not_add_meal'), 'error');
    }
  }, [mealLocked, promptUpgrade, suggestLang, showToast, t]);

  const generateRecipe = useCallback(async (meal: MealPlan) => {
    // A meal with its own recipe keeps its own name — no library aliasing.
    const hasOwn = !!meal.ai_recipe && Object.keys(meal.ai_recipe).length > 0;
    const title = hasOwn ? meal.title : localizedMealTitle(meal.recipe_id, meal.title, suggestLang);
    openRecipe({ recipeId: null, mealId: meal.meal_id, title });
    setRecipeVariant(0);

    // A vegetarian household gets the vegetarian version by default; the veg and
    // omnivore recipes cache in separate slots on the meal so neither shadows
    // the other.
    const want: Diet = householdDiet;
    setRecipeDiet(want);
    const cached = want === 'vegetarian'
      ? meal.ai_recipe_vegetarian?.[suggestLang]
      : meal.ai_recipe?.[suggestLang];
    const known = aiRecipes[meal.meal_id] || cached;
    if (known) {
      setAiRecipes((prev) => ({ ...prev, [meal.meal_id]: known }));
      return;
    }

    setGeneratingFor(meal.meal_id);
    try {
      const { recipe, diet } = await api.generateMealRecipe(meal.meal_id, suggestLang, want);
      setAiRecipes((prev) => ({ ...prev, [meal.meal_id]: recipe }));
      setRecipeDiet(diet);
    } catch (e: any) {
      // Close the sheet rather than leave it sitting empty.
      setCookingRecipe(null);
      showToast(e?.message || t('cook_failed'), 'error');
    } finally {
      setGeneratingFor(null);
    }
  }, [aiRecipes, householdDiet, suggestLang, showToast, t, openRecipe]);

  // Rewrite the recipe already on screen. Vegetarian genuinely swaps the
  // ingredients and steps (not just advice); "different recipe" asks for a
  // fresh take on the same dish. Both go through the one generate path and
  // cache, so re-opening is instant.
  const regenerateRecipe = useCallback(async (opts: { diet?: Diet; variant?: number }) => {
    const mealId = cookingRecipe?.mealId;
    if (!mealId || regenBusy) return;
    const diet = opts.diet !== undefined ? opts.diet : recipeDiet;
    const variant = opts.variant !== undefined ? opts.variant : 0;
    setRegenBusy(true);
    try {
      const { recipe, diet: applied } = await api.generateMealRecipe(mealId, suggestLang, diet, variant);
      setAiRecipes((prev) => ({ ...prev, [mealId]: recipe }));
      setRecipeDiet(applied);
      setRecipeVariant(variant);
    } catch (e: any) {
      showToast(e?.message || t('cook_failed'), 'error');
    } finally {
      setRegenBusy(false);
    }
  }, [cookingRecipe, regenBusy, recipeDiet, suggestLang, showToast, t]);

  // "Ask the AI for a recipe": generate a full recipe from a typed dish name,
  // no plan entry required, and open it in the same recipe view. Metered and
  // safety-gated server-side, exactly like a scan or a chef question.
  const askRecipeAI = useCallback(async () => {
    const dish = recipeAiQuery.trim();
    if (dish.length < 2 || recipeAiBusy) return;
    if (mealLocked) { promptUpgrade('meal_planner'); return; }
    setRecipeAiBusy(true);
    try {
      const { recipe, diet } = await api.generateRecipe(dish, suggestLang, householdDiet);
      setRecipeDiet(diet);
      setServingsOverride(null);
      setCookingRecipe({ recipeId: null, title: dish, adHoc: recipe });
      setRecipeAiQuery('');
    } catch (e: any) {
      showToast(e?.message || t('recipe_ai_failed'), 'error');
    } finally {
      setRecipeAiBusy(false);
    }
  }, [recipeAiQuery, recipeAiBusy, mealLocked, promptUpgrade, suggestLang, householdDiet, showToast, t]);

  // Push an AI recipe's ingredients onto the shopping list. The name is what
  // you shop by, so the plain ingredient name (not the scaled amount) is what
  // lands in the list — categorised the same way scanned items are.
  // "Add what you're missing" on a generated recipe. For an ad-hoc recipe
  // (asked via "Ask the AI", saveToPlanner=true) this does the whole job the
  // user expects: add the ingredients to the shopping list, save the dish into
  // the meal planner so the recipe isn't lost, then jump to the shopping list
  // so the result is visible (previously it added silently behind the modal and
  // looked like nothing happened). A recipe opened from a planned meal is
  // already saved, so it only adds + navigates.
  const addGeneratedToList = useCallback(async (ings: AiIngredient[], mealTitle: string, saveToPlanner: boolean) => {
    const names = ings.map((i) => i.name).filter(Boolean);
    if (!names.length) return;
    try {
      await api.bulkAddShopping(names, names.map((n) => categoriseShoppingItem(n) || undefined));
      setShopItems(await api.listShopping().catch(() => []));

      // Save the dish to the planner (today), unless the planner is Premium-
      // locked or it already lives there. Non-fatal — the list add stands.
      if (saveToPlanner && !mealLocked && mealTitle) {
        const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        try {
          const created = await api.createMeal({ day: today, title: mealTitle, ingredients: names });
          setMeals((prev) => [...prev, created]);
        } catch { /* keep going — the ingredients are already on the list */ }
      }

      // Make the outcome visible: close the recipe and show the shopping list.
      setCookingRecipe(null);
      setView('shop');
      showToast(t('cook_added_to_list', { n: names.length }), 'success');
    } catch (e: any) {
      showToast(e?.message || t('cook_failed'), 'error');
    }
  }, [mealLocked, showToast, t]);

  // The household diet toggle. Persists server-side and is what makes the
  // weekly suggestions and new recipes come out vegetarian by default.
  const toggleHouseholdDiet = useCallback(async () => {
    const next: Diet = householdDiet === 'vegetarian' ? '' : 'vegetarian';
    setHouseholdDiet(next);
    try {
      await api.setMealDiet(next);
    } catch (e: any) {
      setHouseholdDiet(householdDiet);   // revert on failure
      showToast(e?.message || t('cook_failed'), 'error');
    }
  }, [householdDiet, showToast, t]);

  // Closing a preview returns to the browser it came from (which was hidden
  // rather than dismissed — two stacked native modals misbehave on iOS);
  // closing a recipe opened from the plan just closes.
  const closeRecipe = useCallback(() => {
    if (cookingRecipe?.addToDay) setShowBrowse(true);
    setCookingRecipe(null);
  }, [cookingRecipe]);

  // ── History: past shopping trips + saved meal plans ──
  const openShopHistory = useCallback(async () => {
    setShowShopHistory(true);
    setHistLoading(true);
    try { setShopHistory(await api.listShoppingHistory()); }
    catch { /* keep whatever's there */ }
    finally { setHistLoading(false); }
  }, []);

  // Open the selectable "restore items" sheet for a past trip (all pre-ticked).
  const openRestore = useCallback((entry: ShoppingHistoryEntry) => {
    setShowShopHistory(false);
    setRestoreEntry(entry);
    setRestoreSel(new Set(entry.items.map((_, i) => i)));
  }, []);

  const toggleRestore = useCallback((i: number) => {
    setRestoreSel((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!restoreEntry) return;
    const names = restoreEntry.items.filter((_, i) => restoreSel.has(i));
    if (names.length === 0) { setRestoreEntry(null); return; }
    try {
      const r = await api.bulkAddShopping(names, names.map((n) => categoriseShoppingItem(n) || undefined));
      setRestoreEntry(null);
      setShopItems(await api.listShopping().catch(() => []));
      showToast(`${r.added} ${t('vault_ingredients_added_to_list')}`, 'success');
    } catch { showToast(t('vault_could_not_update'), 'error'); }
  }, [restoreEntry, restoreSel, showToast]);

  const deleteShopTrip = useCallback(async (id: string) => {
    setShopHistory((prev) => prev.filter((h) => h.history_id !== id));
    try { await api.deleteShoppingHistory(id); } catch { /* best effort */ }
  }, []);

  // "Never show me old lists again." Plain function: manual memo would
  // block the React Compiler on this screen.
  const clearShopHistory = () => {
    if (shopHistory.length === 0) return;
    Alert.alert(
      t('kitchen_clear_history_q'),
      t('kitchen_clear_history_body'),
      [
        { text: t('vault_cancel'), style: 'cancel' },
        {
          text: t('kitchen_clear_all'),
          style: 'destructive',
          onPress: async () => {
            const previous = shopHistory;
            setShopHistory([]);
            setShowShopHistory(false);
            try {
              await api.clearShoppingHistory();
              showToast(t('kitchen_history_cleared'), 'success');
            } catch {
              setShopHistory(previous);
              showToast(t('vault_could_not_delete_restored'), 'error');
            }
          },
        },
      ],
    );
  };

  const openMealHistory = useCallback(async () => {
    setShowMealHistory(true);
    setHistLoading(true);
    try { setSavedPlans(await api.listSavedPlans()); }
    catch { /* keep */ }
    finally { setHistLoading(false); }
  }, []);

  const savingPlanRef = useRef(false);
  const saveCurrentPlan = useCallback(async () => {
    if (meals.length === 0) { showToast(t('kitchen_nothing_to_save'), 'info'); return; }
    // Guard against a fast double-tap (or Return-then-tap) creating two plans.
    if (savingPlanRef.current) return;
    savingPlanRef.current = true;
    const name = savePlanName.trim() || t('kitchen_saved_plan_default');
    try {
      await api.saveMealPlan(name);
      setSavePlanName('');
      setSavedPlans(await api.listSavedPlans().catch(() => []));
      showToast(t('kitchen_plan_saved'), 'success');
    } catch { showToast(t('vault_could_not_add_meal'), 'error'); }
    finally { savingPlanRef.current = false; }
  }, [meals.length, savePlanName, showToast]);

  const reusePlan = useCallback(async (id: string) => {
    try {
      const r = await api.reuseSavedPlan(id);
      setShowMealHistory(false);
      setMeals(await api.listMeals().catch(() => []));
      showToast(`${r.added} ${t('kitchen_meals_added')}`, 'success');
    } catch { showToast(t('vault_could_not_add_meal'), 'error'); }
  }, [showToast]);

  const deletePlan = useCallback(async (id: string) => {
    setSavedPlans((prev) => prev.filter((p) => p.plan_id !== id));
    try { await api.deleteSavedPlan(id); } catch { /* best effort */ }
  }, []);

  const histDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  };

  const mealsByDay = useMemo(() => {
    const grouped: Record<string, MealPlan[]> = {};
    for (const d of DAYS) grouped[d] = [];
    for (const m of meals) {
      if (grouped[m.day]) grouped[m.day].push(m);
      else grouped[m.day] = [m];
    }
    return grouped;
  }, [meals]);

  const uncheckedItems = useMemo(() => shopItems.filter((i) => !i.checked), [shopItems]);
  const checkedItems = useMemo(() => shopItems.filter((i) => i.checked), [shopItems]);

  const selectView = (v: KitchenView) => setView(v);


  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Kitchen"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
        <ScreenHeader
          eyebrow={t('kitchen_eyebrow')}
          title={t('kitchen')}
        />

        {/* Three ways in, all visible.

            This was a dropdown holding two items - a menu doing a segmented
            control's job, hiding behind a tap what fits on screen. Spending
            joining them would have made it three items behind that tap; putting
            all three out in the open makes the menu unnecessary and reaches the
            meal planner in FEWER taps than before, not more.

            The labels are short because German decides them: three across a
            320px phone leaves about 94px each, and "Einkaufsliste" does not fit
            in that. Liste / Essen / Ausgaben does, and each word is true. */}
        <View style={styles.tabs}>
          {([
            ['shop', t('kit_tab_list')],
            ['meal', t('kit_tab_meals')],
            ['spend', t('kit_tab_spending')],
          ] as [KitchenView, string][]).map(([key, label]) => (
            <PressScale
              key={key}
              testID={`kitchen-tab-${key}`}
              onPress={() => selectView(key)}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={[styles.tab, view === key && styles.tabOn]}
            >
              <Text numberOfLines={1} style={[styles.tabText, view === key && styles.tabTextOn]}>
                {label}
              </Text>
            </PressScale>
          ))}
        </View>

        {/* Keep the screen awake while shopping or cooking — not while reviewing
            Spending, where a screen-on toggle is meaningless and just clutters
            the top of the tab. */}
        {view !== 'spend' ? (
          <PressScale testID="kitchen-keep-awake" onPress={toggleKeepAwake} style={[styles.keepAwake, keepAwake && styles.keepAwakeOn]}>
            <Sun color={keepAwake ? ui.orange : ui.muted} size={16} />
            <Text style={[styles.keepAwakeText, keepAwake && { color: ui.orangeText }]}>
              {keepAwake ? t('kitchen_screen_on') : t('kitchen_screen_on_off')}
            </Text>
          </PressScale>
        ) : null}

        {/* SHOPPING LIST */}
        {view === 'spend' ? (
          <SpendingView embedded />
        ) : view === 'shop' ? (
          <>
            <View style={styles.secHead}>
              <View style={styles.secLeft}>
                <ShoppingCart color={ui.orange} size={20} />
                <Text style={styles.secTitle}>{t('vault_shopping_list')}</Text>
              </View>
              <View style={styles.secRight}>
                {/* Matches the "Clear done" pill beside it rather than sitting
                    there as an unlabelled grey square. */}
                <PressScale testID="shop-history" accessibilityRole="button" accessibilityLabel={t('a11y_history')} onPress={openShopHistory} style={styles.histPill}>
                  <History color={ui.muted} size={13} />
                  <Text style={styles.histPillText} numberOfLines={1}>{t('kitchen_past_trips')}</Text>
                </PressScale>
                {checkedItems.length > 0 ? (
                  <PressScale onPress={clearChecked} style={styles.clearBtn}>
                    <Text style={styles.clearBtnText}>{t('vault_clear_done')}</Text>
                  </PressScale>
                ) : (
                  <Text style={styles.secCount}>{shopItems.length} {shopItems.length === 1 ? t('vault_item') : t('vault_items')}</Text>
                )}
              </View>
            </View>

            {shopItems.length === 0 && shopHistory.length > 0 ? (
              <PressScale testID="restore-banner" onPress={() => openRestore(shopHistory[0])} style={styles.restoreBanner}>
                <View style={styles.restoreIcon}><RotateCcw color={ui.orange} size={18} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.restoreTitle}>{t('kitchen_restore_last')}</Text>
                  <Text style={styles.restoreSub} numberOfLines={1}>{histDate(shopHistory[0].created_at)} · {shopHistory[0].items.length} {shopHistory[0].items.length === 1 ? t('vault_item') : t('vault_items')}</Text>
                </View>
                <Text style={styles.restoreCta}>{t('kitchen_review')}</Text>
                {/* Dismissing is deleting: the banner came back on every
                    visit with no way to say "I don't want this list". */}
                <PressScale
                  testID="restore-dismiss"
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')}
                  onPress={() => deleteShopTrip(shopHistory[0].history_id)}
                  hitSlop={12}
                  style={styles.restoreDismiss}
                >
                  <X color={ui.muted} size={16} />
                </PressScale>
              </PressScale>
            ) : null}

            <View style={styles.card}>
              <View style={styles.shopInputRow}>
                <TextInput
                  value={shopInput}
                  onChangeText={setShopInput}
                  placeholder={t('vault_add_item_placeholder')}
                  placeholderTextColor={ui.muted}
                  style={styles.shopInput}
                  returnKeyType="done"
                  onSubmitEditing={addShopItem}
                />
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_add')} onPress={addShopItem} disabled={addingShop || !shopInput.trim()} style={[styles.shopAddBtn, (!shopInput.trim() || addingShop) && { opacity: 0.4 }]}>
                  <Plus color="#FFFFFF" size={18} />
                </PressScale>
                <PressScale
                  testID="shop-scan"
                  accessibilityRole="button"
                  accessibilityLabel={t('scan_hint')}
                  onPress={openScan}
                  style={styles.shopScanBtn}
                >
                  <Camera color={ui.orange} size={18} />
                </PressScale>
              </View>
              {/* The legend: without it a camera next to a shopping list could
                  mean anything. One line says exactly what it does. */}
              <Text style={styles.scanHint}>{t('scan_hint')}</Text>

              {/* Your regulars — what this household buys often, from past trips,
                  and not on the list right now. One tap adds it back, so the
                  weekly shop is not retyped from memory every week. */}
              {!selectMode && regulars.length > 0 ? (
                <View style={styles.regularsWrap}>
                  <Text style={styles.regularsLabel}>{t('shop_regulars_title')}</Text>
                  <View style={styles.regularsRow}>
                    {regulars.map((r) => (
                      <PressScale
                        key={r.name}
                        testID={`regular-${r.name}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('shop_regulars_add', { name: r.name })}
                        onPress={() => addRegular(r.name)}
                        style={styles.regularChip}
                      >
                        <Plus color={ui.lavenderText} size={13} />
                        <Text style={styles.regularChipText} numberOfLines={1}>{r.name}</Text>
                      </PressScale>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* A full weekly shop ran the page on for screens, burying the
                  meal ideas and the history beneath it. Ten at a time, the
                  rest inside. */}
              <WindowedList testID="shop-list-scroll" count={uncheckedItems.length} window={10}>
                {uncheckedItems.map((item, index) => (
                  <PressScale
                    key={item.item_id}
                    onPress={() => (selectMode ? toggleSelected(item.item_id) : toggleShopItem(item))}
                    onLongPress={() => { setSelectMode(true); toggleSelected(item.item_id); }}
                    style={[styles.row, selectMode && selectedIds.has(item.item_id) && styles.rowSelected]}
                  >
                    {selectMode ? (
                      <View style={[styles.selBox, selectedIds.has(item.item_id) && styles.selBoxOn]}>
                        {selectedIds.has(item.item_id) ? <Check color={ui.bg} size={13} /> : null}
                      </View>
                    ) : (
                      <View style={styles.numBadge}><Text style={styles.numText}>{index + 1}</Text></View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowText}>{item.name}</Text>
                      {/* What the family's own receipts say. Shown here, on the
                          list, because the decision this can change is made
                          before leaving the house — the Spending tab reports
                          the same thing after the money is gone. */}
                      {(() => {
                        const tip = cheaperBy.get(item.name.trim().toLowerCase());
                        if (!tip) return null;
                        return (
                          <Text style={styles.rowCheaper} numberOfLines={1}>
                            {t('kit_cheaper_at', {
                              shop: tip.shop,
                              amount: `${t('currency_symbol')}${tip.saving.toFixed(2)}`,
                              unit: tip.unit,
                            })}
                          </Text>
                        );
                      })()}
                    </View>
                    {(() => {
                      // Everything stored before this shipped is "Other", because the
                      // app never sent a category. Derive from the name in that case
                      // so existing lists gain aisles without a data migration.
                      const cat = item.category && item.category !== 'Other'
                        ? item.category
                        : categoriseShoppingItem(item.name) || item.category;
                      return cat ? <Text style={styles.rowCat}>{catLabel(cat, t)}</Text> : null;
                    })()}
                    <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={t('a11y_delete')} onPress={() => deleteShopItem(item.item_id)} hitSlop={12} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </PressScale>
                ))}
              </WindowedList>
              {uncheckedItems.length > 0 ? <Text style={styles.hint}>{t('vault_shop_tap_hint')}</Text> : null}

              {checkedItems.length > 0 ? (
                <>
                  <View style={styles.divider}><Text style={styles.dividerText}>{t('vault_done')} ({checkedItems.length})</Text></View>
                  {checkedItems.map((item) => (
                    <PressScale
                      key={item.item_id}
                      onPress={() => (selectMode ? toggleSelected(item.item_id) : toggleShopItem(item))}
                      onLongPress={() => { setSelectMode(true); toggleSelected(item.item_id); }}
                      style={[styles.row, selectMode && selectedIds.has(item.item_id) && styles.rowSelected]}
                    >
                      {selectMode ? (
                        <View style={[styles.selBox, selectedIds.has(item.item_id) && styles.selBoxOn]}>
                          {selectedIds.has(item.item_id) ? <Check color={ui.bg} size={13} /> : null}
                        </View>
                      ) : (
                        <Check color={ui.mintText} size={20} />
                      )}
                      <Text style={[styles.rowText, styles.rowTextDone]}>{item.name}</Text>
                      <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => deleteShopItem(item.item_id)} hitSlop={12} style={{ padding: 4 }}>
                        <Trash2 color={ui.muted} size={15} />
                      </PressScale>
                    </PressScale>
                  ))}
                </>
              ) : null}

              {shopItems.length === 0 ? <Text style={styles.empty}>{t('vault_shop_empty')}</Text> : null}

              {shopItems.length > 0 ? (
                selectMode ? (
                  <View style={styles.selBar}>
                    <PressScale testID="shop-select-cancel" onPress={exitSelect} style={styles.selCancelBtn}>
                      <Text style={styles.selCancelText}>{t('cancel')}</Text>
                    </PressScale>
                    <PressScale
                      testID="shop-select-all"
                      onPress={() => setSelectedIds(
                        selectedIds.size === shopItems.length
                          ? new Set()
                          : new Set(shopItems.map((i) => i.item_id)),
                      )}
                      style={styles.selCancelBtn}
                    >
                      <Text style={styles.selCancelText}>
                        {selectedIds.size === shopItems.length ? t('kitchen_select_none') : t('kitchen_select_all')}
                      </Text>
                    </PressScale>
                    <PressScale
                      testID="shop-delete-selected"
                      onPress={deleteSelected}
                      disabled={selectedIds.size === 0}
                      style={[styles.selDeleteBtn, selectedIds.size === 0 && { opacity: 0.45 }]}
                    >
                      <Trash2 color="#FFFFFF" size={14} />
                      <Text style={styles.selDeleteText}>
                        {t('kitchen_delete_selected')}{selectedIds.size ? ` (${selectedIds.size})` : ''}
                      </Text>
                    </PressScale>
                  </View>
                ) : (
                  <View style={styles.shopFooterRow}>
                    <PressScale testID="shop-select-mode" onPress={() => setSelectMode(true)} style={styles.selectModeBtn}>
                      <ListChecks color={ui.text} size={14} />
                      <Text style={styles.selectModeText}>{t('kitchen_select_items')}</Text>
                    </PressScale>
                    {shopItems.length > 1 ? (
                      <PressScale testID="shop-clear-all" onPress={clearAllShop} style={styles.clearAllBtn}>
                        <Trash2 color={ui.danger} size={14} />
                        <Text style={styles.clearAllText}>{t('kitchen_clear_all')}</Text>
                      </PressScale>
                    ) : null}
                  </View>
                )
              ) : null}
            </View>
          </>
        ) : (
          /* MEAL PLANNER */
          <>
            <View style={styles.secHead}>
              <View style={styles.secLeft}>
                <UtensilsCrossed color={ui.lavenderText} size={20} />
                <Text style={styles.secTitle}>{t('vault_meal_planner')}</Text>
              </View>
              {mealLocked ? <LockBadge onPress={() => promptUpgrade('meal_planner')} /> : null}
            </View>

            {/* Free peek: locked families can still OPEN the suggestions sheet —
                seeing 7 concrete dinners sells Premium far better than a lock
                icon. Adding to the planner is what prompts the upgrade. */}
            {mealLocked ? (
              <PressScale testID="meal-suggest" onPress={openSuggest} style={styles.ideasCta}>
                <Sparkles color={ui.lavenderText} size={18} />
                <Text style={styles.ideasCtaText}>{t('meal_ideas_cta')}</Text>
              </PressScale>
            ) : null}

            <PremiumPreviewBanner />

            {/* Primary action: shopping-list meal ideas, full-width so it reads
                as the headline way in. Secondary actions sit in their own row. */}
            {!mealLocked ? (
              <>
                <PressScale testID="meal-suggest" onPress={openSuggest} style={styles.ideasCta}>
                  <Sparkles color={ui.lavenderText} size={18} />
                  <Text style={styles.ideasCtaText}>{t('meal_ideas_cta')}</Text>
                </PressScale>
                <View style={styles.mealActions}>
                  {meals.length > 0 ? (
                    <PressScale onPress={syncMealsToShopping} style={[styles.mealActionBtn, { backgroundColor: ui.mint }]}>
                      <Text style={styles.clearBtnText} numberOfLines={1}>{t('vault_sync_to_list')}</Text>
                    </PressScale>
                  ) : null}
                  <PressScale testID="capture-recipe" onPress={openCapture} style={[styles.mealActionBtn, { backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange }]}>
                    <Camera color={ui.orange} size={14} />
                    <Text style={[styles.clearBtnText, { color: ui.orangeText }]} numberOfLines={1}>{t('capture_chip')}</Text>
                  </PressScale>
                  <PressScale onPress={() => setShowMealAdd(true)} style={[styles.mealActionBtn, { backgroundColor: ui.lavender }]}>
                    <Text style={[styles.clearBtnText, { color: ui.lavenderText }]} numberOfLines={1}>{t('vault_add_short')}</Text>
                  </PressScale>
                  {/* Was a bare grey icon square beside three coloured, labelled
                      pills — it read as a stray control rather than an action.
                      Now it matches its siblings and says what it opens. */}
                  <PressScale testID="meal-history" accessibilityRole="button" accessibilityLabel={t('a11y_history')} onPress={openMealHistory} style={[styles.mealActionBtn, { backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line }]}>
                    <History color={ui.muted} size={14} />
                    <Text style={[styles.clearBtnText, { color: ui.muted }]} numberOfLines={1}>{t('kitchen_saved')}</Text>
                  </PressScale>
                </View>
              </>
            ) : null}
            {/* The legend for the camera — same rule as the shopping page:
                one line saying exactly what it does. */}
            {!mealLocked ? <Text style={styles.scanHint}>{t('capture_hint')}</Text> : null}

            {/* Ask the AI for a recipe: a free-text dish, generated on the spot
                without adding it to the plan first. Opens in the recipe view. */}
            {!mealLocked ? (
              <View style={styles.recipeAiCard}>
                <View style={styles.recipeAiLabel}>
                  <Sparkles color={ui.orangeText} size={15} />
                  <Text style={styles.recipeAiLabelText}>{t('recipe_ai_title')}</Text>
                </View>
                <View style={styles.recipeAiRow}>
                  <TextInput
                    testID="recipe-ai-input"
                    value={recipeAiQuery}
                    onChangeText={setRecipeAiQuery}
                    placeholder={t('recipe_ai_placeholder')}
                    placeholderTextColor={ui.muted}
                    style={styles.recipeAiInput}
                    maxLength={80}
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={askRecipeAI}
                  />
                  <PressScale
                    testID="recipe-ai-go"
                    accessibilityRole="button"
                    accessibilityLabel={t('recipe_ai_cta')}
                    onPress={askRecipeAI}
                    disabled={recipeAiBusy || recipeAiQuery.trim().length < 2}
                    style={styles.recipeAiBtn}
                  >
                    {recipeAiBusy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <ChefHat color="#fff" size={15} />
                        <Text style={styles.recipeAiBtnText}>{t('recipe_ai_cta')}</Text>
                      </>
                    )}
                  </PressScale>
                </View>
                <Text style={styles.recipeAiHint}>{t('recipe_ai_hint')}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              {DAYS.filter((d) => (mealsByDay[d] || []).length > 0).map((day) => (
                <View key={day}>
                  <Text style={styles.mealDayLabel}>{t(`day_${day}`)}</Text>
                  {mealsByDay[day].map((meal) => {
                    // A meal carrying its own recipe (captured from a photo,
                    // or AI-written) is authoritative: never alias it to a
                    // library dish that happens to share the name — the
                    // family wants THEIR version, not ours.
                    const hasOwnRecipe = !!meal.ai_recipe && Object.keys(meal.ai_recipe).length > 0;
                    return (
                    <View key={meal.meal_id} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowText}>{hasOwnRecipe ? meal.title : localizedMealTitle(meal.recipe_id, meal.title, suggestLang)}</Text>
                        {meal.ingredients.length > 0 ? <Text style={styles.rowCat}>{hasOwnRecipe ? meal.ingredients.join(', ') : localizedMealIngredients(meal.recipe_id, meal.ingredients, suggestLang, meal.title).join(', ')}</Text> : null}
                        {hasOwnRecipe ? (
                          <PressScale
                            testID={`cook-own-${meal.meal_id}`}
                            accessibilityRole="button"
                            onPress={() => generateRecipe(meal)}
                            disabled={generatingFor === meal.meal_id}
                            hitSlop={8}
                            style={styles.cookLink}
                          >
                            <ChefHat color={ui.orange} size={13} />
                            <Text style={styles.cookLinkText}>{t('cook_it')}</Text>
                          </PressScale>
                        ) : recipeMethod(resolveRecipeId(meal.recipe_id, meal.title), suggestLang) ? (
                          <PressScale
                            testID={`cook-${meal.meal_id}`}
                            accessibilityRole="button"
                            onPress={() => openRecipe({ recipeId: resolveRecipeId(meal.recipe_id, meal.title)!, title: localizedMealTitle(meal.recipe_id, meal.title, suggestLang) })}
                            hitSlop={8}
                            style={styles.cookLink}
                          >
                            <ChefHat color={ui.orange} size={13} />
                            <Text style={styles.cookLinkText}>{t('cook_it')}</Text>
                          </PressScale>
                        ) : (
                          /* No method in the library — offer to write one. */
                          <PressScale
                            testID={`cook-ai-${meal.meal_id}`}
                            accessibilityRole="button"
                            onPress={() => generateRecipe(meal)}
                            disabled={generatingFor === meal.meal_id}
                            hitSlop={8}
                            style={styles.cookLink}
                          >
                            {generatingFor === meal.meal_id ? (
                              <ActivityIndicator color={ui.orange} size="small" />
                            ) : (
                              <Sparkles color={ui.orange} size={13} />
                            )}
                            <Text style={styles.cookLinkText}>
                              {generatingFor === meal.meal_id ? t('cook_generating') : t('cook_generate')}
                            </Text>
                          </PressScale>
                        )}
                      </View>
                      <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => deleteMeal(meal.meal_id)} hitSlop={12} style={{ padding: 4 }}>
                        <Trash2 color={ui.muted} size={15} />
                      </PressScale>
                    </View>
                    );
                  })}
                </View>
              ))}
              {meals.length === 0 ? (
                <View style={styles.mealEmptyWrap}>
                  <Text style={styles.empty}>{t('vault_meal_empty')}</Text>
                  <PressScale testID="meal-suggest-cta" onPress={openSuggest} style={styles.suggestCta}>
                    <Sparkles color="#FFFFFF" size={16} />
                    <Text style={styles.suggestCtaText}>{t('kitchen_suggest_week')}</Text>
                  </PressScale>
                </View>
              ) : null}

              {meals.length > 1 ? (
                <PressScale testID="meal-clear-all" onPress={clearAllMealsPlan} style={styles.clearAllBtn}>
                  <Trash2 color={ui.danger} size={14} />
                  <Text style={styles.clearAllText}>{t('kitchen_clear_all')}</Text>
                </PressScale>
              ) : null}
            </View>
            {meals.length > 0 ? <Text style={styles.mealTip}>{t('kitchen_sync_tip')}</Text> : null}
          </>
        )}

        <View style={{ height: 120 }} />
      </TabScreen>

      {/* Shopping history */}
      <KeyboardAwareBottomSheet visible={showShopHistory} onClose={() => setShowShopHistory(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kitchen_past_lists')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setShowShopHistory(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        {histLoading ? (
          <ActivityIndicator color={ui.orange} style={{ marginVertical: 24 }} />
        ) : shopHistory.length === 0 ? (
          <Text style={styles.histEmpty}>{t('kitchen_no_past_lists')}</Text>
        ) : (
          shopHistory.map((h) => (
            <View key={h.history_id} style={styles.histRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.histTitle}>{histDate(h.created_at)} · {h.items.length} {h.items.length === 1 ? t('vault_item') : t('vault_items')}</Text>
                <Text style={styles.histSub} numberOfLines={1}>{h.items.join(', ')}</Text>
              </View>
              <PressScale testID={`reuse-trip-${h.history_id}`} onPress={() => openRestore(h)} style={styles.reuseBtn}>
                <RotateCcw color={ui.orange} size={14} />
                <Text style={styles.reuseText}>{t('kitchen_reuse')}</Text>
              </PressScale>
              <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => deleteShopTrip(h.history_id)} hitSlop={12} style={{ padding: 6 }}>
                <Trash2 color={ui.muted} size={15} />
              </PressScale>
            </View>
          ))
        )}
        {shopHistory.length > 0 ? (
          <PressScale testID="shop-history-clear" onPress={clearShopHistory} style={styles.clearAllBtn}>
            <Trash2 color={ui.danger} size={14} />
            <Text style={styles.clearAllText}>{t('kitchen_clear_history')}</Text>
          </PressScale>
        ) : null}
      </KeyboardAwareBottomSheet>

      {/* Restore items from a past list — selectable */}
      <KeyboardAwareBottomSheet visible={restoreEntry !== null} onClose={() => setRestoreEntry(null)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kitchen_restore_items')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setRestoreEntry(null)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        {restoreEntry ? (
          <>
            <View style={styles.restoreSelRow}>
              <Text style={styles.restoreSelText}>{restoreSel.size}/{restoreEntry.items.length} {t('kitchen_selected')}</Text>
              <PressScale
                onPress={() => setRestoreSel(restoreSel.size === restoreEntry.items.length ? new Set() : new Set(restoreEntry.items.map((_, i) => i)))}
                style={styles.selAllBtn}
              >
                <Text style={styles.selAllText}>{restoreSel.size === restoreEntry.items.length ? t('kitchen_clear_all') : t('kitchen_select_all')}</Text>
              </PressScale>
            </View>
            {restoreEntry.items.map((name, i) => {
              const on = restoreSel.has(i);
              return (
                <PressScale key={`${name}-${i}`} testID={`restore-item-${i}`} onPress={() => toggleRestore(i)} style={styles.row}>
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <Check color={ui.bg} size={13} /> : null}
                  </View>
                  <Text style={[styles.rowText, !on && { color: ui.muted }]}>{name}</Text>
                </PressScale>
              );
            })}
            <View style={styles.sheetFooter}>
              <PressScale onPress={() => setRestoreEntry(null)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
              <PressScale testID="confirm-restore" onPress={confirmRestore} disabled={restoreSel.size === 0} style={[styles.saveBtn, restoreSel.size === 0 && { opacity: 0.5 }]}>
                <Text style={styles.saveText}>{t('kitchen_add_selected')} ({restoreSel.size})</Text>
              </PressScale>
            </View>
          </>
        ) : null}
      </KeyboardAwareBottomSheet>

      {/* Saved meal plans */}
      <KeyboardAwareBottomSheet visible={showMealHistory} onClose={() => setShowMealHistory(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kitchen_saved_plans')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setShowMealHistory(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <View style={styles.savePlanRow}>
          <TextInput
            value={savePlanName}
            onChangeText={setSavePlanName}
            placeholder={t('kitchen_name_this_plan')}
            placeholderTextColor={ui.muted}
            style={styles.shopInput}
            returnKeyType="done"
            onSubmitEditing={saveCurrentPlan}
          />
          <PressScale testID="save-plan" onPress={saveCurrentPlan} style={[styles.clearBtn, { backgroundColor: ui.lavender }]}>
            <Text style={[styles.clearBtnText, { color: ui.lavenderText }]}>{t('vault_save')}</Text>
          </PressScale>
        </View>
        {histLoading ? (
          <ActivityIndicator color={ui.lavenderText} style={{ marginVertical: 24 }} />
        ) : savedPlans.length === 0 ? (
          <Text style={styles.histEmpty}>{t('kitchen_no_saved_plans')}</Text>
        ) : (
          savedPlans.map((p) => (
            <View key={p.plan_id} style={styles.histRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.histTitle}>{p.name}</Text>
                <Text style={styles.histSub} numberOfLines={1}>{histDate(p.created_at)} · {p.meals.length} {p.meals.length === 1 ? t('kitchen_meal_word') : t('kitchen_meals_word')}</Text>
              </View>
              <PressScale testID={`reuse-plan-${p.plan_id}`} onPress={() => reusePlan(p.plan_id)} style={styles.reuseBtn}>
                <RotateCcw color={ui.orange} size={14} />
                <Text style={styles.reuseText}>{t('kitchen_reuse')}</Text>
              </PressScale>
              <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => deletePlan(p.plan_id)} hitSlop={12} style={{ padding: 6 }}>
                <Trash2 color={ui.muted} size={15} />
              </PressScale>
            </View>
          ))
        )}
      </KeyboardAwareBottomSheet>

      {/* Browse every recipe, search it, and drop one on any day */}
      <KeyboardAwareBottomSheet visible={showBrowse} onClose={() => { setShowBrowse(false); setBrowseQuery(''); }} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('browse_recipes')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={() => { setShowBrowse(false); setBrowseQuery(''); }}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        <View style={styles.savePlanRow}>
          <Search color={ui.muted} size={18} />
          <TextInput
            value={browseQuery}
            onChangeText={setBrowseQuery}
            placeholder={t('browse_search')}
            placeholderTextColor={ui.muted}
            style={[styles.shopInput, { flex: 1 }]}
            autoCorrect={false}
          />
        </View>

        {/* Which day the next pick lands on. A wrapping row, not a horizontal
            ScrollView: this sheet's list would not scroll on Android, and the
            only structural difference from the sheets that do scroll was a
            nested scroller — the same trap this file already documents for
            vertical ones. Wrapping also puts all seven days on screen; the
            scroller showed four and hid the weekend behind a swipe nobody
            would discover. */}
        <View style={styles.browseDayRow}>
          {DAYS.map((d) => (
            <PressScale
              key={d}
              testID={`browse-day-${d}`}
              onPress={() => setBrowseDay(d)}
              style={[styles.browseDayChip, browseDay === d && styles.browseDayChipActive]}
            >
              <Text style={[styles.browseDayText, browseDay === d && styles.browseDayTextActive]}>
                {t(`day_${d}`)}
              </Text>
            </PressScale>
          ))}
        </View>

        {(() => {
          const results = searchRecipes(browseQuery, suggestLang);
          if (results.length === 0) {
            return <Text style={styles.histEmpty}>{t('browse_none')}</Text>;
          }
          return results.map((r) => {
            const method = recipeMethod(r.id, suggestLang);
            return (
            <View key={r.id} style={styles.browseRow}>
              {/* The row body opens the recipe itself — time, amounts, steps —
                  so a parent reads before committing it to a day. The browser
                  is hidden (not dismissed) while the page is up; the page's
                  back action brings it straight back. */}
              <PressScale
                testID={`browse-open-${r.id}`}
                accessibilityRole="button"
                accessibilityLabel={r.title}
                onPress={() => {
                  setShowBrowse(false);
                  openRecipe({ recipeId: r.id, title: r.title, addToDay: browseDay });
                }}
                style={{ flex: 1, minWidth: 0 }}
              >
                <Text style={styles.browseTitle}>{r.title}</Text>
                {method ? (
                  <View style={styles.browseMeta}>
                    <Clock color={ui.muted} size={11} />
                    <Text style={styles.browseIng}>{t('cook_minutes', { n: method.minutes })}</Text>
                  </View>
                ) : null}
                <Text style={styles.browseIng} numberOfLines={1}>{r.ingredients.join(', ')}</Text>
              </PressScale>
              <PressScale
                testID={`browse-add-${r.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${t('browse_add_to_day')} ${t(`day_${browseDay}`)}`}
                onPress={() => addRecipeToDay(r.id, r.title, browseDay)}
                style={styles.reuseBtn}
              >
                <Plus color={ui.orange} size={14} />
                <Text style={styles.reuseText}>{t('vault_add_short')}</Text>
              </PressScale>
            </View>
          );
          });
        })()}
      </KeyboardAwareBottomSheet>

      {/* The recipe, full screen. A recipe you cook from deserves the whole
          display: bigger type, the steps front and centre, and room for the
          servings maths — the old bottom sheet buried all of it. */}
      <Modal visible={cookingRecipe !== null} animationType="slide" onRequestClose={closeRecipe}>
        <SafeAreaView style={styles.recipeSafe} edges={['top', 'bottom']}>
          {(() => {
            if (!cookingRecipe) return null;
            const generated = cookingRecipe.mealId ? aiRecipes[cookingRecipe.mealId] : cookingRecipe.adHoc;
            const method = recipeMethod(cookingRecipe.recipeId, suggestLang) ?? generated ?? null;
            const isGenerated = !cookingRecipe.recipeId;
            const ingredients = localizedMealIngredients(cookingRecipe.recipeId, [], suggestLang, cookingRecipe.title);
            return (
              <>
                <View style={styles.recipeTopBar}>
                  <PressScale
                    testID="recipe-back"
                    accessibilityRole="button"
                    accessibilityLabel={t('close')}
                    onPress={closeRecipe}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <ChevronLeft color={ui.text} size={24} />
                  </PressScale>
                </View>

                {!method ? (
                  /* The AI is still writing this one. */
                  <View style={styles.recipeLoading}>
                    <ActivityIndicator color={ui.orange} size="large" />
                    <Text style={styles.recipeLoadingText}>{t('cook_generating')}</Text>
                  </View>
                ) : (
                  <KeyboardAwareScrollView style={{ flex: 1 }} contentContainerStyle={styles.recipeScroll}>
                    <Text style={styles.recipeTitle}>{cookingRecipe.title}</Text>
                    {isGenerated && recipeDiet === 'vegetarian' ? (
                      <View testID="recipe-veg-badge" style={styles.vegBadge}>
                        <Leaf color={ui.mintText} size={12} />
                        <Text style={styles.vegBadgeText}>{t('recipe_vegetarian')}</Text>
                      </View>
                    ) : null}
                    <View style={styles.cookMeta}>
                      <Clock color={ui.muted} size={14} />
                      <Text style={styles.cookMetaText}>
                        {t('cook_minutes', { n: method.minutes })} · {t('recipe_steps_n', { n: method.steps.length })}
                      </Text>
                    </View>

                    {cookingRecipe.recipeId ? (
                      <>
                        <View style={styles.servingsRow}>
                          <Text style={styles.cookSectionTitle}>{t('cook_servings')}</Text>
                          <View style={styles.stepper}>
                            <PressScale
                              accessibilityRole="button"
                              accessibilityLabel="-"
                              onPress={() => setServings(Math.max(1, servings - 1))}
                              hitSlop={10}
                              style={styles.stepBtn}
                            >
                              <Minus color={ui.text} size={16} />
                            </PressScale>
                            <Text style={styles.stepCount}>{servings}</Text>
                            <PressScale
                              accessibilityRole="button"
                              accessibilityLabel="+"
                              onPress={() => setServings(Math.min(12, servings + 1))}
                              hitSlop={10}
                              style={styles.stepBtn}
                            >
                              <Plus color={ui.text} size={16} />
                            </PressScale>
                          </View>
                        </View>

                        <Text style={styles.cookSectionTitle}>{t('cook_you_need')}</Text>
                        {recipeIngredients(cookingRecipe.recipeId, suggestLang).map((ing) => {
                          const qty = quantityFor(ing.id, servings, suggestLang);
                          return (
                            <View key={ing.id} style={styles.qtyRow}>
                              <Text style={styles.qtyName}>{ing.label}</Text>
                              {qty ? <Text style={styles.qtyAmount}>{qty}</Text> : null}
                            </View>
                          );
                        })}
                        <Text style={styles.qtyNote}>{t('cook_amounts_note')}</Text>

                        <PressScale
                          testID="cook-add-missing"
                          accessibilityRole="button"
                          onPress={() => addMissingToList(cookingRecipe.recipeId!)}
                          style={styles.addMissingBtn}
                        >
                          <ShoppingCart color={ui.orange} size={15} />
                          <Text style={styles.addMissingText}>{t('cook_add_missing')}</Text>
                        </PressScale>
                      </>
                    ) : generated?.ingredients?.length ? (
                      /* AI recipe with quantified ingredients: same servings
                         maths as the curated library, scaled from the base the
                         amounts were written for. */
                      <>
                        <View style={styles.servingsRow}>
                          <Text style={styles.cookSectionTitle}>{t('cook_servings')}</Text>
                          <View style={styles.stepper}>
                            <PressScale
                              accessibilityRole="button"
                              accessibilityLabel="-"
                              onPress={() => setServings(Math.max(1, servings - 1))}
                              hitSlop={10}
                              style={styles.stepBtn}
                            >
                              <Minus color={ui.text} size={16} />
                            </PressScale>
                            <Text style={styles.stepCount}>{servings}</Text>
                            <PressScale
                              accessibilityRole="button"
                              accessibilityLabel="+"
                              onPress={() => setServings(Math.min(12, servings + 1))}
                              hitSlop={10}
                              style={styles.stepBtn}
                            >
                              <Plus color={ui.text} size={16} />
                            </PressScale>
                          </View>
                        </View>

                        <Text style={styles.cookSectionTitle}>{t('cook_you_need')}</Text>
                        {generated.ingredients.map((ing, idx) => {
                          const qty = formatAiQuantity(ing, servings, generated.servings || 4, suggestLang);
                          return (
                            <View key={idx} style={styles.qtyRow}>
                              <Text style={styles.qtyName}>{ing.name}</Text>
                              {qty ? <Text style={styles.qtyAmount}>{qty}</Text> : null}
                            </View>
                          );
                        })}
                        <Text style={styles.qtyNote}>{t('cook_amounts_note')}</Text>

                        <PressScale
                          testID="cook-add-generated"
                          accessibilityRole="button"
                          onPress={() => addGeneratedToList(generated.ingredients!, cookingRecipe.title, !cookingRecipe.mealId)}
                          style={styles.addMissingBtn}
                        >
                          <ShoppingCart color={ui.orange} size={15} />
                          <Text style={styles.addMissingText}>{t('cook_add_missing')}</Text>
                        </PressScale>
                      </>
                    ) : ingredients.length > 0 ? (
                      <>
                        <Text style={styles.cookSectionTitle}>{t('cook_you_need')}</Text>
                        <Text style={styles.cookIngredients}>{ingredients.join(' · ')}</Text>
                      </>
                    ) : null}

                    <Text style={styles.cookSectionTitle}>{t('cook_method')}</Text>
                    {method.steps.map((step, i) => (
                      <View key={i} style={styles.cookStep}>
                        <View style={styles.cookStepNum}>
                          <Text style={styles.cookStepNumText}>{i + 1}</Text>
                        </View>
                        <Text style={styles.cookStepText}>{step}</Text>
                      </View>
                    ))}

                    {/* AI recipes can be re-cooked: vegetarian genuinely rewrites
                        the ingredients and steps, and "different recipe" asks for
                        a fresh take on the same dish. Curated library dishes are
                        fixed, so these only show for generated recipes. */}
                    {isGenerated && cookingRecipe.mealId ? (
                      <View style={styles.recipeActions}>
                        {recipeDiet !== 'vegetarian' ? (
                          <PressScale
                            testID="recipe-make-veg"
                            accessibilityRole="button"
                            onPress={() => regenerateRecipe({ diet: 'vegetarian', variant: 0 })}
                            disabled={regenBusy}
                            style={styles.recipeActionBtn}
                          >
                            <Leaf color={ui.mintText} size={15} />
                            <Text style={styles.recipeActionText}>{t('cook_make_veg')}</Text>
                          </PressScale>
                        ) : null}
                        <PressScale
                          testID="recipe-different"
                          accessibilityRole="button"
                          onPress={() => regenerateRecipe({ variant: recipeVariant + 1 })}
                          disabled={regenBusy}
                          style={styles.recipeActionBtn}
                        >
                          <Shuffle color={ui.orange} size={15} />
                          <Text style={styles.recipeActionText}>{t('cook_different')}</Text>
                        </PressScale>
                        {regenBusy ? <ActivityIndicator color={ui.orange} size="small" /> : null}
                      </View>
                    ) : null}

                    {/* The advisor half: substitutions, variations, timing.
                        The question is free text but bounded — sanitised,
                        length-capped and the answer validated server-side
                        before it is shown. */}
                    <Text style={styles.cookSectionTitle}>{t('chef_title')}</Text>
                    <View style={styles.chefChips}>
                      {/* On an AI recipe, "make it vegetarian" is a real rewrite
                          above, not advice — so this advice chip only shows for
                          curated dishes, which cannot be regenerated. */}
                      {!isGenerated ? (
                        <PressScale
                          testID="chef-chip-veg"
                          accessibilityRole="button"
                          onPress={() => askChef(t('chef_chip_veg'))}
                          disabled={chefBusy}
                          style={styles.chefChip}
                        >
                          <Text style={styles.chefChipText}>{t('chef_chip_veg')}</Text>
                        </PressScale>
                      ) : null}
                      <PressScale
                        testID="chef-chip-faster"
                        accessibilityRole="button"
                        onPress={() => askChef(t('chef_chip_faster'))}
                        disabled={chefBusy}
                        style={styles.chefChip}
                      >
                        <Text style={styles.chefChipText}>{t('chef_chip_faster')}</Text>
                      </PressScale>
                    </View>
                    <View style={styles.chefAskRow}>
                      <TextInput
                        testID="chef-input"
                        value={chefQuestion}
                        onChangeText={setChefQuestion}
                        placeholder={t('chef_placeholder')}
                        placeholderTextColor={ui.muted}
                        style={[styles.shopInput, { flex: 1 }]}
                        maxLength={120}
                        autoCorrect={false}
                        onSubmitEditing={() => askChef(chefQuestion)}
                      />
                      <PressScale
                        testID="chef-ask"
                        accessibilityRole="button"
                        accessibilityLabel={t('chef_title')}
                        onPress={() => askChef(chefQuestion)}
                        disabled={chefBusy}
                        style={styles.chefAskBtn}
                      >
                        {chefBusy ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Sparkles color="#fff" size={16} />
                        )}
                      </PressScale>
                    </View>
                    {chefAnswer ? (
                      <View testID="chef-answer" style={styles.chefAnswer}>
                        <Text style={styles.chefAnswerText}>{chefAnswer}</Text>
                        <Text style={styles.chefAnswerNote}>{t('cook_ai_note')}</Text>
                      </View>
                    ) : null}

                    {/* Stated every time rather than once: the person cooking may not
                        be the parent who planned the week. */}
                    <View style={styles.cookAllergen}>
                      <AlertTriangle color={ui.muted} size={14} />
                      <Text style={styles.cookAllergenText}>
                        {isGenerated ? `${t('cook_ai_note')} ${t('cook_allergen_note')}` : t('cook_allergen_note')}
                      </Text>
                    </View>
                  </KeyboardAwareScrollView>
                )}

                {/* Preview from the browser: commit it to the chosen day from
                    right here, after reading — not before. */}
                {cookingRecipe.addToDay && cookingRecipe.recipeId && method ? (
                  <PressScale
                    testID="recipe-add-day"
                    accessibilityRole="button"
                    onPress={() => {
                      addRecipeToDay(cookingRecipe.recipeId!, cookingRecipe.title, cookingRecipe.addToDay!);
                      setCookingRecipe(null);
                    }}
                    style={styles.recipeAddBtn}
                  >
                    <Plus color="#fff" size={16} />
                    <Text style={styles.recipeAddText}>
                      {t('browse_add_to_day')} {t(`day_${cookingRecipe.addToDay}`)}
                    </Text>
                  </PressScale>
                ) : null}
              </>
            );
          })()}
        </SafeAreaView>
      </Modal>

      <KeyboardAwareBottomSheet visible={showMealAdd} onClose={() => setShowMealAdd(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('vault_add_meal')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setShowMealAdd(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>{t('vault_day')}</Text>
        {/* A wrapping row, not a horizontal ScrollView — nested scrollers
            freeze the sheet on Android, and wrapping shows all seven days. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {DAYS.map((d) => (
            <PressScale key={d} onPress={() => setMealDay(d)} style={[styles.mealDayChip, mealDay === d && styles.mealDayChipActive]}>
              <Text style={[styles.mealDayChipText, mealDay === d && styles.mealDayChipTextActive]}>{t(`day_${d}`).slice(0, 3)}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.label}>{t('vault_meal')}</Text>
        <TextInput value={mealTitle} onChangeText={setMealTitle} placeholder={t('vault_meal_title_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <Text style={styles.label}>{t('vault_ingredients_label')}</Text>
        <TextInput value={mealIngredients} onChangeText={setMealIngredients} placeholder={t('vault_ingredients_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale onPress={() => setShowMealAdd(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('vault_cancel')}</Text></PressScale>
          <PressScale onPress={addMeal} disabled={!mealTitle.trim()} style={[styles.saveBtn, !mealTitle.trim() && { opacity: 0.5 }]}><Text style={styles.saveText}>{t('vault_save')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Snap a paper shopping list — reviewable candidates, never a silent add */}
      <KeyboardAwareBottomSheet
        visible={showScan}
        onClose={() => setShowScan(false)}
        contentStyle={styles.sheet}
        footer={scanPhase === 'review' ? (
          <PressScale
            testID="scan-add"
            accessibilityRole="button"
            onPress={addScannedItems}
            disabled={scanAdding || scanItems.every((i) => !i.checked)}
            style={[styles.suggestAllBtn, (scanAdding || scanItems.every((i) => !i.checked)) && { opacity: 0.5 }]}
          >
            <Text style={styles.suggestAllText}>
              {scanItems.filter((i) => i.checked).length === 1
                ? t('scan_add_one')
                : t('scan_add_n', { n: scanItems.filter((i) => i.checked).length })}
            </Text>
          </PressScale>
        ) : undefined}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('scan_title')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={() => setShowScan(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        {scanPhase === 'reading' ? (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 14 }}>
            <ActivityIndicator color={ui.orange} size="large" />
            <Text style={styles.suggestSub}>{t('scan_reading')}</Text>
          </View>
        ) : scanPhase === 'review' ? (
          <>
            <Text style={styles.suggestSub}>{scanItems.length === 1 ? t('scan_sub_one') : t('scan_sub', { n: scanItems.length })}</Text>
            {scanItems.map((item, idx) => (
              <PressScale
                key={`${item.name}-${idx}`}
                testID={`scan-item-${idx}`}
                accessibilityRole="button"
                onPress={() => toggleScanItem(idx)}
                style={styles.scanRow}
              >
                <View style={[styles.scanCheck, item.checked && styles.scanCheckOn]}>
                  {item.checked ? <Check color="#fff" size={14} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowText}>{item.name}</Text>
                  {item.unsure ? <Text style={styles.scanUnsure}>{t('scan_unsure')}</Text> : null}
                </View>
                <Text style={styles.rowCat}>{categoriseShoppingItem(item.name) || ''}</Text>
              </PressScale>
            ))}
            {shopItems.length > 0 ? (
              <PressScale
                testID="scan-replace"
                accessibilityRole="button"
                onPress={() => setScanReplace((v) => !v)}
                style={styles.scanRow}
              >
                <View style={[styles.scanCheck, scanReplace && styles.scanCheckOn]}>
                  {scanReplace ? <Check color="#fff" size={14} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowText}>{t('scan_replace_list')}</Text>
                  <Text style={styles.scanUnsure}>
                    {shopItems.length === 1
                      ? t('scan_replace_hint_one')
                      : t('scan_replace_hint', { n: shopItems.length })}
                  </Text>
                </View>
              </PressScale>
            ) : null}
            <PressScale
              accessibilityRole="button"
              onPress={() => { setScanPhase('idle'); setScanItems([]); }}
              style={styles.scanRetake}
            >
              <Text style={styles.scanRetakeText}>{t('scan_retake')}</Text>
            </PressScale>
            <View style={styles.cookAllergen}>
              <AlertTriangle color={ui.muted} size={14} />
              <Text style={styles.cookAllergenText}>{t('scan_note')}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.suggestSub}>{t('scan_hint')}</Text>
            {scanError ? <Text style={styles.scanError}>{scanError}</Text> : null}
            <PressScale testID="scan-camera" accessibilityRole="button" onPress={() => pickScan('camera')} style={styles.scanSourceBtn}>
              <Camera color={ui.orange} size={18} />
              <Text style={styles.scanSourceText}>{t('scan_take')}</Text>
            </PressScale>
            <PressScale testID="scan-gallery" accessibilityRole="button" onPress={() => pickScan('library')} style={styles.scanSourceBtn}>
              <ImageIcon color={ui.orange} size={18} />
              <Text style={styles.scanSourceText}>{t('scan_gallery')}</Text>
            </PressScale>
          </>
        )}
      </KeyboardAwareBottomSheet>

      {/* Capture a printed recipe — review it in full, then commit to a day */}
      <KeyboardAwareBottomSheet
        visible={showCapture}
        onClose={() => setShowCapture(false)}
        contentStyle={styles.sheet}
        footer={capturePhase === 'review' && captured ? (
          <PressScale
            testID="capture-add"
            accessibilityRole="button"
            onPress={addCapturedMeal}
            disabled={captureAdding}
            style={[styles.suggestAllBtn, captureAdding && { opacity: 0.5 }]}
          >
            <Text style={styles.suggestAllText}>
              {t('browse_add_to_day')} {t(`day_${captureDay}`)}
            </Text>
          </PressScale>
        ) : undefined}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('capture_title')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={() => setShowCapture(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        {capturePhase === 'reading' ? (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 14 }}>
            <ActivityIndicator color={ui.orange} size="large" />
            <Text style={styles.suggestSub}>{t('capture_reading')}</Text>
          </View>
        ) : capturePhase === 'review' && captured ? (
          <>
            <Text style={styles.captureTitle}>{captured.title}</Text>
            <View style={styles.cookMeta}>
              <Clock color={ui.muted} size={13} />
              <Text style={styles.cookMetaText}>
                {t('cook_minutes', { n: captured.minutes })} · {t('recipe_steps_n', { n: captured.steps.length })}
              </Text>
            </View>

            <Text style={styles.cookSectionTitle}>{t('cook_you_need')}</Text>
            {captured.ingredients.map((ing, idx) => {
              const qty = formatAiQuantity(ing, captured.servings, captured.servings, suggestLang);
              return (
                <View key={idx} style={styles.qtyRow}>
                  <Text style={styles.qtyName}>{ing.name}</Text>
                  {qty ? <Text style={styles.qtyAmount}>{qty}</Text> : null}
                </View>
              );
            })}

            <Text style={styles.cookSectionTitle}>{t('cook_method')}</Text>
            {captured.steps.map((step, i) => (
              <View key={i} style={styles.cookStep}>
                <View style={styles.cookStepNum}>
                  <Text style={styles.cookStepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.cookStepText}>{step}</Text>
              </View>
            ))}

            <Text style={styles.cookSectionTitle}>{t('vault_day')}</Text>
            <View style={styles.browseDayRow}>
              {DAYS.map((d) => (
                <PressScale
                  key={d}
                  testID={`capture-day-${d}`}
                  onPress={() => setCaptureDay(d)}
                  style={[styles.browseDayChip, captureDay === d && styles.browseDayChipActive]}
                >
                  <Text style={[styles.browseDayText, captureDay === d && styles.browseDayTextActive]}>
                    {t(`day_${d}`)}
                  </Text>
                </PressScale>
              ))}
            </View>

            <PressScale
              accessibilityRole="button"
              onPress={() => { setCapturePhase('idle'); setCaptured(null); }}
              style={styles.scanRetake}
            >
              <Text style={styles.scanRetakeText}>{t('scan_retake')}</Text>
            </PressScale>
            <View style={styles.cookAllergen}>
              <AlertTriangle color={ui.muted} size={14} />
              <Text style={styles.cookAllergenText}>
                {`${t('capture_note')} ${t('cook_allergen_note')}`}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.suggestSub}>{t('capture_hint')}</Text>
            {captureError ? <Text style={styles.scanError}>{captureError}</Text> : null}
            <PressScale testID="capture-camera" accessibilityRole="button" onPress={() => pickCapture('camera')} style={styles.scanSourceBtn}>
              <Camera color={ui.orange} size={18} />
              <Text style={styles.scanSourceText}>{t('scan_take')}</Text>
            </PressScale>
            <PressScale testID="capture-gallery" accessibilityRole="button" onPress={() => pickCapture('library')} style={styles.scanSourceBtn}>
              <ImageIcon color={ui.orange} size={18} />
              <Text style={styles.scanSourceText}>{t('scan_gallery')}</Text>
            </PressScale>
          </>
        )}
      </KeyboardAwareBottomSheet>

      {/* Suggest a week of meals from your shopping */}
      <KeyboardAwareBottomSheet
        visible={showSuggest}
        onClose={() => setShowSuggest(false)}
        contentStyle={styles.sheet}
        footer={
          <PressScale
            testID="suggest-add-all"
            onPress={acceptAllSuggestions}
            disabled={suggestLoading}
            style={[styles.suggestAllBtn, suggestLoading && { opacity: 0.5 }]}
          >
            <Text style={styles.suggestAllText}>{t('kitchen_suggest_add_all')}</Text>
          </PressScale>
        }
      >
        <View style={styles.sheetHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Sparkles color={ui.lavenderText} size={20} />
            <Text style={styles.sheetTitle}>{t('kitchen_suggest_title')}</Text>
          </View>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setShowSuggest(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.suggestSub}>
          {suggestLoading
            ? t('kitchen_ai_planning')
            : suggestFellBack
              ? (suggestError || t('kitchen_ai_fallback'))
              : t('kitchen_suggest_sub')}
        </Text>

        {/* Ask again for a different week. The server excludes anything already
            planned, so this genuinely varies rather than reshuffling. */}
        {!suggestLoading ? (
          <PressScale
            testID="suggest-again"
            accessibilityRole="button"
            onPress={askAgain}
            style={styles.againBtn}
          >
            <Sparkles color={ui.orange} size={14} />
            <Text style={styles.againText}>{t('kitchen_new_ideas')}</Text>
          </PressScale>
        ) : (
          <ActivityIndicator color={ui.orange} style={{ marginVertical: 12 }} />
        )}

        {/* A vegetarian household turns this on once; the week comes back
            vegetarian and so do the recipes, without asking each time. */}
        <PressScale
          testID="suggest-veg-toggle"
          accessibilityRole="button"
          accessibilityLabel={t('kitchen_veg_household')}
          onPress={async () => { await toggleHouseholdDiet(); loadSuggestions(suggestVariant); }}
          style={[styles.vegToggle, householdDiet === 'vegetarian' && styles.vegToggleOn]}
        >
          <Leaf color={householdDiet === 'vegetarian' ? ui.mintText : ui.muted} size={14} />
          <Text style={[styles.vegToggleText, householdDiet === 'vegetarian' && { color: ui.mintText }]}>
            {t('kitchen_veg_household')}
          </Text>
        </PressScale>

        {/* Stated here as well as in the recipe, because "Add all to planner"
            commits a whole week without opening a single dish — which is the
            path most people take, and the one where nobody would otherwise see
            an ingredient list at all. */}
        {!suggestLoading && suggestions.length > 0 ? (
          <View style={styles.suggestAllergen}>
            <AlertTriangle color={ui.muted} size={13} />
            <Text style={styles.suggestAllergenText}>{t('suggest_allergen_note')}</Text>
          </View>
        ) : null}

        {/* No inner ScrollView here — the sheet itself scrolls; nesting two
            vertical scrollers makes the list unscrollable on Android. */}
        {suggestions.map((s) => {
          const added = addedSuggest.has(sugKey(s));
          return (
            <View key={sugKey(s)} style={styles.suggestRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.suggestDay}>{t(`day_${s.day}`)}</Text>
                <Text style={styles.suggestTitle}>{s.title}</Text>
                {s.haveLabels.length > 0 ? (
                  <Text style={styles.suggestHave} numberOfLines={2}>{t('kitchen_suggest_have')}: {s.haveLabels.join(', ')}</Text>
                ) : null}
                {s.needLabels.length > 0 ? (
                  <Text style={styles.suggestNeed} numberOfLines={2}>{t('kitchen_suggest_need')}: {s.needLabels.join(', ')}</Text>
                ) : null}
              </View>
              <PressScale testID={`suggest-add-${s.recipeId}`} onPress={() => acceptSuggestion(s)} disabled={added || suggestLoading} style={[styles.suggestAddBtn, added && styles.suggestAddedBtn, suggestLoading && { opacity: 0.5 }]}>
                {added ? <Check color={ui.mintText} size={15} /> : <Plus color={ui.lavenderText} size={15} />}
                <Text style={[styles.suggestAddText, added && { color: ui.mintText }]}>{added ? t('kitchen_suggest_added') : t('kitchen_suggest_add')}</Text>
              </PressScale>
            </View>
          );
        })}
      </KeyboardAwareBottomSheet>

      <LoadingOverlay visible={loading} label={t('vault_loading')} />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  tabs: {
    // No horizontal margin: styles.scroll already pads this content by 20.
    flexDirection: 'row', gap: 4, padding: 3, marginTop: 4, marginBottom: 10,
    backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 12,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, borderRadius: 9 },
  tabOn: { backgroundColor: ui.card },
  tabText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.muted },
  tabTextOn: { color: ui.text },
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },


  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 12 },
  secRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // A soft-filled quiet button, not an outlined box. As a card-coloured
  // outline it read as a stray dark blob among the labelled colour buttons in
  // the row (a lone circle in dark mode). Soft fill, same pill radius and row
  // height, so it belongs with the set as the secondary "past lists" action.
  // A defined, readable icon button — not a dark blob. In dark mode a plain
  // soft fill sat too close to the page and the muted icon vanished, so the
  // history control read as a stray dark box beside the three bright labelled
  // buttons. A hairline border gives it an edge and the icon takes the ink
  // colour, so it reads as the deliberate "past lists / past plans" button.
  histBtn: { width: 44, alignSelf: 'stretch', borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },
  // Prominent, labelled call-to-action for the shopping-list meal ideas — now
  // one of the two main ways users get recipes, so it leads the row.
  ideasCta: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, backgroundColor: ui.lavender, alignSelf: 'stretch', justifyContent: 'center', marginBottom: 10 },
  ideasCtaText: { color: ui.lavenderText, fontFamily: 'Inter_700Bold', fontSize: 14 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: ui.line },
  histTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  histSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  histEmpty: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  reuseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: ui.orangeSoft },
  reuseText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  savePlanRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  restoreBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.orangeSoft, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12 },
  restoreIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
  restoreTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  restoreSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 1 },
  restoreCta: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  restoreSelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  restoreSelText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  selAllBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line },
  selAllText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: ui.orangeDeep, borderColor: ui.orange },
  secLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  secTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  secCount: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: ui.mint },
  histPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line },
  histPillText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12 },
  clearBtnText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12 },

  card: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, padding: 14, gap: 4 },
  shopInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  shopScanBtn: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ui.orange, backgroundColor: ui.orangeSoft },
  scanHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11.5, marginBottom: 10, marginTop: 2 },
  regularsWrap: { marginTop: 4, marginBottom: 8 },
  regularsLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12, marginBottom: 8 },
  regularsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  regularChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: ui.lavender },
  regularChipText: { color: ui.lavenderText, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  scanRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  scanCheck: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  scanCheckOn: { backgroundColor: ui.orangeDeep, borderColor: ui.orange },
  // Ink, not fill: the hardcoded gold here read at ~1.7:1 on the sheet and
  // never adapted to dark. goldText is the AA-clearing twin.
  scanUnsure: { color: ui.goldText, fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 1 },
  scanRetake: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  scanRetakeText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  // An error a parent has to read; the hardcoded salmon failed AA at 13px.
  scanError: { color: ui.danger, fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10 },
  scanSourceBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: ui.orange, borderRadius: 999, paddingVertical: 13, marginTop: 10 },
  scanSourceText: { color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  captureTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 22, letterSpacing: -0.4, lineHeight: 27 },
  shopInput: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.text, backgroundColor: ui.soft },
  // Same 42/14 as shopScanBtn beside it: they were 38/12 vs 42/14, so the two
  // icon buttons in one row sat at different heights and radii. Add stays a
  // solid fill (primary) and scan an outline (secondary) — that contrast is
  // intended; only the geometry needed to match so the row lines up.
  shopAddBtn: { width: 42, height: 42, borderRadius: 14, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  numBadge: { width: 24, height: 24, borderRadius: 99, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  numText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  hint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', paddingTop: 10 },
  rowText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowCheaper: {
    color: ui.mintText, fontFamily: 'Inter_500Medium', fontSize: 11.5, marginTop: 1,
  },
  rowTextDone: { textDecorationLine: 'line-through', color: ui.muted },
  rowCat: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },
  divider: { marginTop: 8, paddingVertical: 4 },
  dividerText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', paddingVertical: 14 },
  mealDayLabel: { color: ui.lavenderText, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 2 },
  mealTip: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 19, marginTop: 12 },
  keepAwake: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 12, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.card },
  keepAwakeOn: { borderColor: ui.orange + '55', backgroundColor: ui.orangeSoft },
  keepAwakeText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  mealEmptyWrap: { alignItems: 'center', paddingVertical: 6 },
  // The labelled actions share the row equally and run its full width; the
  // dead space on the right made them look like leftovers rather than a set.
  // The history icon keeps its square: stretching an icon-only, rarely-used
  // control to a quarter of the row would give it the same weight as Capture.
  // Four actions do not fit one phone row: forcing them to share it shrank every
  // pill until its label truncated ("Sync to l…", "Capture reci…", "+ A…").
  // Let them wrap instead — two comfortable rows beat one unreadable one.
  mealActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  // flexGrow rather than flex: 1. Exactly equal thirds is narrower than "Sync
  // to list" needs (~98px with its padding, against ~90px available on a 390px
  // phone) and German is longer still, so equal widths would truncate the label
  // it is named after. Growing from natural width fills the row just as
  // completely without clipping anything.
  mealActionBtn: { flexGrow: 0, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 99 },
  restoreDismiss: { padding: 4, marginLeft: 2 },
  shopFooterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  selectModeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
  },
  selectModeText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12 },
  rowSelected: { backgroundColor: ui.orangeSoft },
  selBox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 2, borderColor: ui.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  selBoxOn: { backgroundColor: ui.orangeDeep, borderColor: ui.orange },
  selBar: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  selCancelBtn: {
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
    borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
  },
  selCancelText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12 },
  selDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: ui.danger,
  },
  selDeleteText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  // Matched to selectModeBtn beside it — same height, padding and radius — so
  // the two footer buttons read as a pair and sit on the same line. It carried
  // a leftover marginTop:12 from when it was stacked, which pushed it below
  // "Select items" in the row; and no horizontal padding, so it was a different
  // size. Kept red-tinted, because clearing the list is the destructive one.
  clearAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: ui.dangerSoft },
  clearAllText: { color: ui.danger, fontFamily: 'Inter_700Bold', fontSize: 13 },
  suggestCta: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 99, backgroundColor: ui.lavenderText, marginTop: 4 },
  suggestCtaText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  suggestSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 20, marginBottom: 8 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderTopWidth: 1, borderTopColor: ui.line },
  suggestDay: { color: ui.lavenderText, fontFamily: 'Inter_800ExtraBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15.5, marginTop: 1 },
  suggestHave: { color: ui.mintText, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 3 },
  suggestNeed: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  suggestAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 99, backgroundColor: ui.lavender },
  suggestAddedBtn: { backgroundColor: ui.mintText + '22' },
  suggestAddText: { color: ui.lavenderText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  suggestAllBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: 99, backgroundColor: ui.lavenderText },
  suggestAllText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
  servingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, backgroundColor: ui.soft, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 4 },
  stepBtn: { padding: 6 },
  stepCount: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 16, minWidth: 20, textAlign: 'center' },
  qtyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: ui.line },
  qtyName: { flex: 1, color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 15 },
  qtyAmount: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  qtyNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  addMissingBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: ui.orange },
  addMissingText: { color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  recipeAiCard: { backgroundColor: ui.card, borderRadius: 16, borderWidth: 1, borderColor: ui.orangeSoft, padding: 13, marginBottom: 12 },
  recipeAiLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  recipeAiLabelText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase' },
  recipeAiRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recipeAiInput: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: ui.text, backgroundColor: ui.soft },
  recipeAiBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 78, justifyContent: 'center', backgroundColor: ui.orange, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 12 },
  recipeAiBtnText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 13.5 },
  recipeAiHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11.5, marginTop: 8 },
  browseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ui.line },
  browseTitle: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  browseIng: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  browseMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // The recipe as a destination: full screen, generous type, one clear action.
  recipeSafe: { flex: 1, backgroundColor: ui.bg },
  recipeTopBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  recipeScroll: { paddingHorizontal: 26, paddingTop: 4, paddingBottom: 60 },
  recipeTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 28, letterSpacing: -0.5, lineHeight: 34 },
  recipeLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  recipeLoadingText: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14 },
  recipeAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 26, marginBottom: 14, paddingVertical: 15, borderRadius: 999, backgroundColor: ui.orangeDeep },
  recipeAddText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 },
  chefChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chefChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line },
  chefChipText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  recipeActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  recipeActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line },
  recipeActionText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  vegBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 8, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: ui.mint },
  vegBadgeText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.2 },
  vegToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 4, marginBottom: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: ui.line },
  vegToggleOn: { borderColor: ui.mintText, backgroundColor: ui.mint },
  vegToggleText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  chefAskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chefAskBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center' },
  chefAnswer: { backgroundColor: ui.soft, borderRadius: 14, padding: 14, marginTop: 12 },
  chefAnswerText: { color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22 },
  chefAnswerNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  browseDayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  browseDayChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: ui.soft },
  browseDayChipActive: { backgroundColor: ui.orangeDeep },
  browseDayText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  browseDayTextActive: { color: '#FFFFFF' },
  againBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 10, marginBottom: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: ui.orange },
  againText: { color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cookLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  cookLinkText: { color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cookMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  cookMetaText: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  cookSectionTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 18, marginBottom: 8 },
  cookIngredients: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  // Sized to read from a counter with wet hands, not a phone held close.
  cookStep: { flexDirection: 'row', gap: 14, marginBottom: 16, alignItems: 'flex-start' },
  cookStepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  cookStepNumText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 14 },
  cookStepText: { flex: 1, color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 25 },
  cookAllergen: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: ui.line },
  suggestAllergen: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 4, marginBottom: 12 },
  suggestAllergenText: { flex: 1, color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17 },
  cookAllergenText: { flex: 1, color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  label: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  mealDayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  mealDayChipActive: { backgroundColor: ui.lavender, borderColor: ui.lavenderText },
  mealDayChipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, textTransform: 'capitalize' },
  mealDayChipTextActive: { color: ui.lavenderText },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orangeDeep },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
