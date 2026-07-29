import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View, Text, StyleSheet, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Plus, X, Trash2, ShoppingCart, Check, UtensilsCrossed, Bell, ChevronDown, History, RotateCcw, Sparkles, Sun, ChefHat, Clock, AlertTriangle, Search, Minus, BookOpen } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { ScreenHeader, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, MealPlan, ShoppingItem, ShoppingHistoryEntry, SavedMealPlan } from '../../src/api';
import { usePremiumGate, LockBadge, PremiumPreviewBanner } from '../../src/components/PremiumGate';
import { logger } from '../../src/logger';
import { suggestWeek, MealSuggestion, SuggestLang, localizedMealTitle, localizedMealIngredients, resolveRecipeId, recipeIngredients, searchRecipes } from '../../src/mealSuggestions';
import { quantityFor, shoppingNameFor } from '../../src/recipeQuantities';
import { categoriseShoppingItem } from '../../src/shoppingCategories';
import { recipeMethod } from '../../src/recipeSteps';

type ToastState = { message: string; tone: ToastTone };
type KitchenView = 'shop' | 'meal';

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
  const { t, lang, subscription } = useStore();
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
  const [aiRecipes, setAiRecipes] = useState<Record<string, { minutes: number; steps: string[] }>>({});
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  // Recipe id currently open in the Cook sheet, with the title to head it.
  const [cookingRecipe, setCookingRecipe] = useState<{ recipeId: string | null; mealId?: string; title: string } | null>(null);
  const suggestLang = useMemo<SuggestLang>(
    () => (['en', 'es', 'fr', 'de'].includes(lang) ? (lang as SuggestLang) : 'en'),
    [lang],
  );
  const { isLocked, promptUpgrade } = usePremiumGate();
  const mealLocked = isLocked('meal_planner');
  const router = useRouter();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [view, setView] = useState<KitchenView>('shop');
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

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

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  const load = useCallback(async () => {
    try {
      const [shopRes, mealRes, histRes] = await Promise.allSettled([api.listShopping(), api.listMeals(), api.listShoppingHistory()]);
      if (shopRes.status === 'fulfilled') setShopItems(shopRes.value);
      if (mealRes.status === 'fulfilled') setMeals(mealRes.value);
      if (histRes.status === 'fulfilled') setShopHistory(histRes.value);
    } catch (e: any) {
      logger.warn('Kitchen load failed:', e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
                  date: new Date().toLocaleDateString(),
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
    setSuggestions(localWeek(0));
    setShowSuggest(true);
    loadSuggestions(0);
  }, [shopItems.length, localWeek, loadSuggestions, showToast, t]);

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
    if (mealLocked) { promptUpgrade('meal_planner'); return; }
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
    if (mealLocked) { promptUpgrade('meal_planner'); return; }
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
    if (mealLocked) { promptUpgrade('meal_planner'); return; }
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
    const title = localizedMealTitle(meal.recipe_id, meal.title, suggestLang);
    setCookingRecipe({ recipeId: null, mealId: meal.meal_id, title });

    // Already generated for this language, either this session or a previous one.
    const known = aiRecipes[meal.meal_id] || meal.ai_recipe?.[suggestLang];
    if (known) {
      setAiRecipes((prev) => ({ ...prev, [meal.meal_id]: known }));
      return;
    }

    setGeneratingFor(meal.meal_id);
    try {
      const { recipe } = await api.generateMealRecipe(meal.meal_id, suggestLang);
      setAiRecipes((prev) => ({ ...prev, [meal.meal_id]: recipe }));
    } catch (e: any) {
      // Close the sheet rather than leave it sitting empty.
      setCookingRecipe(null);
      showToast(e?.message || t('cook_failed'), 'error');
    } finally {
      setGeneratingFor(null);
    }
  }, [aiRecipes, suggestLang, showToast, t]);

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

  const openMealHistory = useCallback(async () => {
    setShowMealHistory(true);
    setHistLoading(true);
    try { setSavedPlans(await api.listSavedPlans()); }
    catch { /* keep */ }
    finally { setHistLoading(false); }
  }, []);

  const saveCurrentPlan = useCallback(async () => {
    if (meals.length === 0) { showToast(t('kitchen_nothing_to_save'), 'info'); return; }
    const name = savePlanName.trim() || t('kitchen_saved_plan_default');
    try {
      await api.saveMealPlan(name);
      setSavePlanName('');
      setSavedPlans(await api.listSavedPlans().catch(() => []));
      showToast(t('kitchen_plan_saved'), 'success');
    } catch { showToast(t('vault_could_not_add_meal'), 'error'); }
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

  const selectView = (v: KitchenView) => { setView(v); setMenuOpen(false); };

  const shopSub = `${shopItems.length} ${shopItems.length === 1 ? t('vault_item') : t('vault_items')}`;
  const mealSub = `${meals.length} ${meals.length === 1 ? t('kitchen_meal_word') : t('kitchen_meals_word')}`;

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
          right={
            <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_notifications')} onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
              <Bell color={ui.text} size={24} />
            </PressScale>
          }
        />

        {/* Dropdown switcher */}
        <View style={styles.switchWrap}>
          <PressScale testID="kitchen-switch" onPress={() => setMenuOpen((o) => !o)} style={styles.switchBtn}>
            <View style={styles.switchLeft}>
              <View style={[styles.switchPill, { backgroundColor: view === 'shop' ? ui.orangeSoft : ui.lavender }]}>
                {view === 'shop'
                  ? <ShoppingCart color={ui.orange} size={20} />
                  : <UtensilsCrossed color={ui.lavenderText} size={20} />}
              </View>
              <View>
                <Text style={styles.switchName}>{view === 'shop' ? t('vault_shopping_list') : t('vault_meal_planner')}</Text>
                <Text style={styles.switchSub}>{view === 'shop' ? shopSub : mealSub}</Text>
              </View>
            </View>
            <ChevronDown color={ui.muted} size={20} style={{ transform: [{ rotate: menuOpen ? '180deg' : '0deg' }] }} />
          </PressScale>

          {menuOpen ? (
            <View style={styles.menu}>
              <PressScale testID="kitchen-pick-shop" onPress={() => selectView('shop')} style={styles.menuItem}>
                <View style={[styles.switchPill, styles.menuPill, { backgroundColor: ui.orangeSoft }]}>
                  <ShoppingCart color={ui.orange} size={17} />
                </View>
                <Text style={styles.menuText}>{t('vault_shopping_list')}</Text>
                {view === 'shop' ? <Check color={ui.orange} size={18} style={{ marginLeft: 'auto' }} /> : null}
              </PressScale>
              <PressScale testID="kitchen-pick-meal" onPress={() => selectView('meal')} style={[styles.menuItem, styles.menuItemBorder]}>
                <View style={[styles.switchPill, styles.menuPill, { backgroundColor: ui.lavender }]}>
                  <UtensilsCrossed color={ui.lavenderText} size={17} />
                </View>
                <Text style={styles.menuText}>{t('vault_meal_planner')}</Text>
                {view === 'meal' ? <Check color={ui.lavenderText} size={18} style={{ marginLeft: 'auto' }} /> : null}
              </PressScale>
            </View>
          ) : null}
        </View>

        {/* Keep the screen awake while shopping / cooking */}
        <PressScale testID="kitchen-keep-awake" onPress={toggleKeepAwake} style={[styles.keepAwake, keepAwake && styles.keepAwakeOn]}>
          <Sun color={keepAwake ? ui.orange : ui.muted} size={16} />
          <Text style={[styles.keepAwakeText, keepAwake && { color: ui.orange }]}>
            {keepAwake ? t('kitchen_screen_on') : t('kitchen_screen_on_off')}
          </Text>
        </PressScale>

        {/* SHOPPING LIST */}
        {view === 'shop' ? (
          <>
            <View style={styles.secHead}>
              <View style={styles.secLeft}>
                <ShoppingCart color={ui.orange} size={20} />
                <Text style={styles.secTitle}>{t('vault_shopping_list')}</Text>
              </View>
              <View style={styles.secRight}>
                <PressScale testID="shop-history" accessibilityRole="button" accessibilityLabel={t('a11y_history')} onPress={openShopHistory} style={styles.histBtn}>
                  <History color={ui.muted} size={18} />
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
              </View>

              {uncheckedItems.map((item, index) => (
                <PressScale key={item.item_id} onPress={() => toggleShopItem(item)} style={styles.row}>
                  <View style={styles.numBadge}><Text style={styles.numText}>{index + 1}</Text></View>
                  <Text style={styles.rowText}>{item.name}</Text>
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
              {uncheckedItems.length > 0 ? <Text style={styles.hint}>{t('vault_shop_tap_hint')}</Text> : null}

              {checkedItems.length > 0 ? (
                <>
                  <View style={styles.divider}><Text style={styles.dividerText}>{t('vault_done')} ({checkedItems.length})</Text></View>
                  {checkedItems.map((item) => (
                    <PressScale key={item.item_id} onPress={() => toggleShopItem(item)} style={styles.row}>
                      <Check color={ui.mintText} size={20} />
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

              {shopItems.length > 1 ? (
                <PressScale testID="shop-clear-all" onPress={clearAllShop} style={styles.clearAllBtn}>
                  <Trash2 color={ui.danger} size={14} />
                  <Text style={styles.clearAllText}>{t('kitchen_clear_all')}</Text>
                </PressScale>
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
              <View style={styles.mealActions}>
                <PressScale testID="meal-suggest" onPress={openSuggest} style={styles.histBtn}>
                  <Sparkles color={ui.lavenderText} size={18} />
                </PressScale>
              </View>
            ) : null}

            <PremiumPreviewBanner />

            {/* Actions get their own wrapping row so "Sync to list" is never cut off. */}
            {!mealLocked ? (
              <View style={styles.mealActions}>
                <PressScale testID="meal-suggest" onPress={openSuggest} style={styles.histBtn}>
                  <Sparkles color={ui.lavenderText} size={18} />
                </PressScale>
                <PressScale testID="meal-history" onPress={openMealHistory} style={styles.histBtn}>
                  <History color={ui.muted} size={18} />
                </PressScale>
                {meals.length > 0 ? (
                  <PressScale onPress={syncMealsToShopping} style={styles.clearBtn}>
                    <Text style={styles.clearBtnText}>{t('vault_sync_to_list')}</Text>
                  </PressScale>
                ) : null}
                <PressScale testID="browse-recipes" onPress={() => setShowBrowse(true)} style={[styles.clearBtn, { backgroundColor: ui.soft }]}>
                  <BookOpen color={ui.text} size={14} />
                  <Text style={[styles.clearBtnText, { color: ui.text }]}>{t('browse_recipes')}</Text>
                </PressScale>
                <PressScale onPress={() => setShowMealAdd(true)} style={[styles.clearBtn, { backgroundColor: ui.lavender }]}>
                  <Text style={[styles.clearBtnText, { color: ui.lavenderText }]}>{t('vault_add_short')}</Text>
                </PressScale>
              </View>
            ) : null}

            <View style={styles.card}>
              {DAYS.filter((d) => (mealsByDay[d] || []).length > 0).map((day) => (
                <View key={day}>
                  <Text style={styles.mealDayLabel}>{t(`day_${day}`)}</Text>
                  {mealsByDay[day].map((meal) => (
                    <View key={meal.meal_id} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowText}>{localizedMealTitle(meal.recipe_id, meal.title, suggestLang)}</Text>
                        {meal.ingredients.length > 0 ? <Text style={styles.rowCat}>{localizedMealIngredients(meal.recipe_id, meal.ingredients, suggestLang, meal.title).join(', ')}</Text> : null}
                        {/* Only offered where we actually have a method — a dead
                            button on a meal the parent typed themselves is worse
                            than no button. */}
                        {recipeMethod(resolveRecipeId(meal.recipe_id, meal.title), suggestLang) ? (
                          <PressScale
                            testID={`cook-${meal.meal_id}`}
                            accessibilityRole="button"
                            onPress={() => setCookingRecipe({ recipeId: resolveRecipeId(meal.recipe_id, meal.title)!, title: localizedMealTitle(meal.recipe_id, meal.title, suggestLang) })}
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
                  ))}
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

        {/* Which day the next pick lands on. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
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
        </ScrollView>

        {(() => {
          const results = searchRecipes(browseQuery, suggestLang);
          if (results.length === 0) {
            return <Text style={styles.histEmpty}>{t('browse_none')}</Text>;
          }
          return results.map((r) => (
            <View key={r.id} style={styles.browseRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.browseTitle}>{r.title}</Text>
                <Text style={styles.browseIng} numberOfLines={1}>{r.ingredients.join(', ')}</Text>
              </View>
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
          ));
        })()}
      </KeyboardAwareBottomSheet>

      {/* Cook it — method for a meal from the suggestion library */}
      <KeyboardAwareBottomSheet visible={cookingRecipe !== null} onClose={() => setCookingRecipe(null)} contentStyle={styles.sheet}>
        {(() => {
          if (!cookingRecipe) return null;
          const generated = cookingRecipe.mealId ? aiRecipes[cookingRecipe.mealId] : undefined;
          const method = recipeMethod(cookingRecipe.recipeId, suggestLang) ?? generated ?? null;
          if (!method) return null;
          const isGenerated = !cookingRecipe.recipeId;
          const ingredients = localizedMealIngredients(cookingRecipe.recipeId, [], suggestLang, cookingRecipe.title);
          return (
            <>
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.sheetTitle} numberOfLines={2}>{cookingRecipe.title}</Text>
                  <View style={styles.cookMeta}>
                    <Clock color={ui.muted} size={13} />
                    <Text style={styles.cookMetaText}>{t('cook_minutes', { n: method.minutes })}</Text>
                  </View>
                </View>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                  onPress={() => setCookingRecipe(null)}
                  style={styles.iconBtn}
                >
                  <X color={ui.text} size={20} />
                </PressScale>
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

              {/* Stated every time rather than once: the person cooking may not
                  be the parent who planned the week. */}
              <View style={styles.cookAllergen}>
                <AlertTriangle color={ui.muted} size={14} />
                <Text style={styles.cookAllergenText}>
                  {isGenerated ? `${t('cook_ai_note')} ${t('cook_allergen_note')}` : t('cook_allergen_note')}
                </Text>
              </View>
            </>
          );
        })()}
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showMealAdd} onClose={() => setShowMealAdd(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('vault_add_meal')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setShowMealAdd(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>{t('vault_day')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {DAYS.map((d) => (
              <PressScale key={d} onPress={() => setMealDay(d)} style={[styles.mealDayChip, mealDay === d && styles.mealDayChipActive]}>
                <Text style={[styles.mealDayChipText, mealDay === d && styles.mealDayChipTextActive]}>{t(`day_${d}`).slice(0, 3)}</Text>
              </PressScale>
            ))}
          </View>
        </ScrollView>
        <Text style={styles.label}>{t('vault_meal')}</Text>
        <TextInput value={mealTitle} onChangeText={setMealTitle} placeholder={t('vault_meal_title_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <Text style={styles.label}>{t('vault_ingredients_label')}</Text>
        <TextInput value={mealIngredients} onChangeText={setMealIngredients} placeholder={t('vault_ingredients_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale onPress={() => setShowMealAdd(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('vault_cancel')}</Text></PressScale>
          <PressScale onPress={addMeal} disabled={!mealTitle.trim()} style={[styles.saveBtn, !mealTitle.trim() && { opacity: 0.5 }]}><Text style={styles.saveText}>{t('vault_save')}</Text></PressScale>
        </View>
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
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  switchWrap: { marginTop: 16, position: 'relative', zIndex: 20 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13 },
  switchLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchPill: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  switchName: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.3 },
  switchSub: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 1 },
  menu: { position: 'absolute', top: 70, left: 0, right: 0, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, overflow: 'hidden', zIndex: 30, elevation: 12, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  menuItemBorder: { borderTopWidth: 1, borderTopColor: ui.line },
  menuPill: { width: 32, height: 32, borderRadius: 9 },
  menuText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },

  secHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 12 },
  secRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histBtn: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: ui.line },
  histTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  histSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  histEmpty: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  reuseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: ui.orangeSoft },
  reuseText: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  savePlanRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  restoreBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.orangeSoft, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12 },
  restoreIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
  restoreTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  restoreSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 1 },
  restoreCta: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  restoreSelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  restoreSelText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  selAllBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line },
  selAllText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: ui.orange, borderColor: ui.orange },
  secLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  secTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  secCount: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: ui.mint },
  clearBtnText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12 },

  card: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, padding: 14, gap: 4 },
  shopInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  shopInput: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.text, backgroundColor: ui.soft },
  shopAddBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  numBadge: { width: 24, height: 24, borderRadius: 99, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  numText: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  hint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', paddingTop: 10 },
  rowText: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
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
  mealActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  clearAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 9, borderRadius: 99, backgroundColor: ui.dangerSoft },
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
  addMissingText: { color: ui.orange, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  browseRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ui.line },
  browseTitle: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  browseIng: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  browseDayChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: ui.soft, marginRight: 8 },
  browseDayChipActive: { backgroundColor: ui.orange },
  browseDayText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  browseDayTextActive: { color: '#FFFFFF' },
  againBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 10, marginBottom: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: ui.orange },
  againText: { color: ui.orange, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cookLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  cookLinkText: { color: ui.orange, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cookMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  cookMetaText: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13 },
  cookSectionTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 18, marginBottom: 8 },
  cookIngredients: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  cookStep: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  cookStepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  cookStepNumText: { color: ui.orange, fontFamily: 'Inter_700Bold', fontSize: 13 },
  cookStepText: { flex: 1, color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22 },
  cookAllergen: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: ui.line },
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
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orange },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
