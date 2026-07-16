import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Plus, X, Trash2, ShoppingCart, Check, UtensilsCrossed, Bell, ChevronDown } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { ScreenHeader, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, MealPlan, ShoppingItem } from '../../src/api';
import { usePremiumGate, LockBadge } from '../../src/components/PremiumGate';
import { logger } from '../../src/logger';

type ToastState = { message: string; tone: ToastTone };
type KitchenView = 'shop' | 'meal';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function Kitchen() {
  const { t } = useStore();
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

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  const load = useCallback(async () => {
    try {
      const [shopRes, mealRes] = await Promise.allSettled([api.listShopping(), api.listMeals()]);
      if (shopRes.status === 'fulfilled') setShopItems(shopRes.value);
      if (mealRes.status === 'fulfilled') setMeals(mealRes.value);
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

  const addShopItem = useCallback(async () => {
    if (!shopInput.trim()) return;
    setAddingShop(true);
    try {
      const item = await api.addShoppingItem({ name: shopInput.trim() });
      setShopItems((prev) => [item, ...prev]);
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
            <PressScale onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
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

        {/* SHOPPING LIST */}
        {view === 'shop' ? (
          <>
            <View style={styles.secHead}>
              <View style={styles.secLeft}>
                <ShoppingCart color={ui.orange} size={20} />
                <Text style={styles.secTitle}>{t('vault_shopping_list')}</Text>
              </View>
              {checkedItems.length > 0 ? (
                <PressScale onPress={clearChecked} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>{t('vault_clear_done')}</Text>
                </PressScale>
              ) : (
                <Text style={styles.secCount}>{shopItems.length} {shopItems.length === 1 ? t('vault_item') : t('vault_items')}</Text>
              )}
            </View>

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
                <PressScale onPress={addShopItem} disabled={addingShop || !shopInput.trim()} style={[styles.shopAddBtn, (!shopInput.trim() || addingShop) && { opacity: 0.4 }]}>
                  <Plus color="#FFFFFF" size={18} />
                </PressScale>
              </View>

              {uncheckedItems.map((item, index) => (
                <PressScale key={item.item_id} onPress={() => toggleShopItem(item)} style={styles.row}>
                  <View style={styles.numBadge}><Text style={styles.numText}>{index + 1}</Text></View>
                  <Text style={styles.rowText}>{item.name}</Text>
                  {item.category ? <Text style={styles.rowCat}>{item.category}</Text> : null}
                  <PressScale onPress={() => deleteShopItem(item.item_id)} style={{ padding: 4 }}>
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
                      <PressScale onPress={() => deleteShopItem(item.item_id)} style={{ padding: 4 }}>
                        <Trash2 color={ui.muted} size={15} />
                      </PressScale>
                    </PressScale>
                  ))}
                </>
              ) : null}

              {shopItems.length === 0 ? <Text style={styles.empty}>{t('vault_shop_empty')}</Text> : null}
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
              {mealLocked ? (
                <LockBadge onPress={() => promptUpgrade('meal_planner')} />
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {meals.length > 0 ? (
                    <PressScale onPress={syncMealsToShopping} style={styles.clearBtn}>
                      <Text style={styles.clearBtnText}>{t('vault_sync_to_list')}</Text>
                    </PressScale>
                  ) : null}
                  <PressScale onPress={() => setShowMealAdd(true)} style={[styles.clearBtn, { backgroundColor: ui.lavender }]}>
                    <Text style={[styles.clearBtnText, { color: ui.lavenderText }]}>{t('vault_add_short')}</Text>
                  </PressScale>
                </View>
              )}
            </View>

            <View style={styles.card}>
              {DAYS.filter((d) => (mealsByDay[d] || []).length > 0).map((day) => (
                <View key={day}>
                  <Text style={styles.mealDayLabel}>{day.charAt(0).toUpperCase() + day.slice(1)}</Text>
                  {mealsByDay[day].map((meal) => (
                    <View key={meal.meal_id} style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowText}>{meal.title}</Text>
                        {meal.ingredients.length > 0 ? <Text style={styles.rowCat}>{meal.ingredients.join(', ')}</Text> : null}
                      </View>
                      <PressScale onPress={() => deleteMeal(meal.meal_id)} style={{ padding: 4 }}>
                        <Trash2 color={ui.muted} size={15} />
                      </PressScale>
                    </View>
                  ))}
                </View>
              ))}
              {meals.length === 0 ? <Text style={styles.empty}>{t('vault_meal_empty')}</Text> : null}
            </View>
            {meals.length > 0 ? <Text style={styles.mealTip}>{t('kitchen_sync_tip')}</Text> : null}
          </>
        )}

        <View style={{ height: 120 }} />
      </TabScreen>

      <KeyboardAwareBottomSheet visible={showMealAdd} onClose={() => setShowMealAdd(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('vault_add_meal')}</Text>
          <PressScale onPress={() => setShowMealAdd(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>{t('vault_day')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {DAYS.map((d) => (
              <PressScale key={d} onPress={() => setMealDay(d)} style={[styles.mealDayChip, mealDay === d && styles.mealDayChipActive]}>
                <Text style={[styles.mealDayChipText, mealDay === d && styles.mealDayChipTextActive]}>{d.slice(0, 3)}</Text>
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

  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
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
