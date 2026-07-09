import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Pressable,
  Image,
  Alert,
  Modal,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, Trash2, Stethoscope, BookOpen, Shield, Scale, Bell, Folder, MoreVertical, FileText, ShoppingCart, Check, Circle, UtensilsCrossed, AlertTriangle, ChevronRight, ShoppingBag } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { Badge, Card, IconTile, ProgressBar, ScreenHeader, UI, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, logEvent, Entitlements, ExpiryAlert, MealPlan, ShoppingItem, VaultDoc } from '../../src/api';
import { usePremiumGate, LockBadge } from '../../src/components/PremiumGate';
import { logger } from '../../src/logger';

const CATEGORIES = [
  { key: 'Medical', icon: Stethoscope, tone: UI.orange, soft: UI.orangeSoft },
  { key: 'School', icon: BookOpen, tone: UI.lavenderText, soft: UI.lavender },
  { key: 'Insurance', icon: Shield, tone: UI.mintText, soft: UI.mint },
  { key: 'Legal', icon: Scale, tone: UI.goldText, soft: UI.gold },
];

function catInfo(key: string) {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
}

function updatedLine(iso: string, t: (k: string) => string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${t('vault_updated')} ${d.toLocaleDateString([], { month: 'short', day: '2-digit' })}`;
}

type ToastState = { message: string; tone: ToastTone };

export default function Vault() {
  const { t } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const mealLocked = isLocked('meal_planner');
  const router = useRouter();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<VaultDoc | null>(null);
  const [filter, setFilter] = useState<string>('All');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Medical');
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [shopItems, setShopItems] = useState<ShoppingItem[]>([]);
  const [shopInput, setShopInput] = useState('');
  const [addingShop, setAddingShop] = useState(false);
  const [meals, setMeals] = useState<MealPlan[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
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
      const [vaultRes, shopRes, mealRes, expiryRes, entRes] = await Promise.allSettled([api.listVault(), api.listShopping(), api.listMeals(), api.vaultExpiryAlerts(), api.getEntitlements()]);
      if (vaultRes.status === 'fulfilled') setDocs(vaultRes.value);
      if (shopRes.status === 'fulfilled') setShopItems(shopRes.value);
      if (mealRes.status === 'fulfilled') setMeals(mealRes.value);
      if (expiryRes.status === 'fulfilled') setExpiryAlerts(expiryRes.value);
      if (entRes.status === 'fulfilled') setEntitlements(entRes.value);
      if (vaultRes.status === 'rejected') {
        logger.warn('Vault load failed:', vaultRes.reason);
        showToast(t('vault_could_not_load'), 'error');
      }
    } catch (e: any) {
      logger.warn('Vault load failed:', e?.message || e);
      showToast(e?.message || t('vault_could_not_load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const usedBytes = useMemo(() => {
    // Prefer the server-computed total; fall back to estimating from loaded docs.
    if (entitlements) return entitlements.vault_bytes_used;
    return docs.reduce((sum, d) => sum + (d.image_base64?.length || 0) * 0.75, 0);
  }, [entitlements, docs]);
  const usedMb = usedBytes / (1024 * 1024);
  const limitMb = entitlements ? entitlements.vault_bytes_limit / (1024 * 1024) : 500;
  const usedLabel = usedMb >= 1 ? `${usedMb.toFixed(0)} MB` : `${(usedMb * 1024).toFixed(0)} KB`;
  const storagePct = limitMb > 0 ? Math.min(100, (usedMb / limitMb) * 100) : 0;

  const filtered = useMemo(() => (filter === 'All' ? docs : docs.filter((d) => d.category === filter)), [docs, filter]);

  const openAdd = () => {
    setTitle('');
    setCategory('Medical');
    setImage(null);
    setShowAdd(true);
  };
  const closeAdd = () => setShowAdd(false);

  const pickImage = async () => {
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('vault_permission_needed'), t('vault_gallery_access_required'));
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        const imageValue = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setImage(imageValue);
      }
    } catch (e: any) {
      logger.warn('pickImage failed:', e?.message || e);
      Alert.alert(t('vault_could_not_open_gallery'), t('vault_please_try_again'));
    }
  };

  const save = async () => {
    if (!title.trim() || !image) return;
    setSaving(true);
    try {
      const created = await api.createVaultDoc({ title: title.trim(), category, image_base64: image });
      setDocs((prev) => [created, ...prev]);
      setTitle('');
      setImage(null);
      setCategory('Medical');
      setShowAdd(false);
      showToast(t('vault_document_saved'), 'success');
      logEvent('vault_added');
    } catch (e: any) {
      logger.warn('Save vault document failed:', e?.message || e);
      showToast(e?.message || t('vault_could_not_save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: VaultDoc) => {
    const previous = docs;
    setDocs((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));
    setPreview(null);
    try {
      await api.deleteVaultDoc(doc.doc_id);
      showToast(t('vault_document_deleted'), 'success');
    } catch (e: any) {
      logger.warn('Delete vault document failed:', e?.message || e);
      setDocs(previous);
      showToast(t('vault_could_not_delete'), 'error');
      load();
    }
  };

  const confirmRemove = (doc: VaultDoc) => {
    Alert.alert(
      t('vault_delete_document_title'),
      `"${doc.title}" ${t('vault_delete_doc_message')}`,
      [
        { text: t('vault_cancel'), style: 'cancel' },
        { text: t('vault_delete'), style: 'destructive', onPress: () => remove(doc) },
      ],
    );
  };

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

  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

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

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Vault"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
          <ScreenHeader
            eyebrow={t('vault_secure_storage')}
            title={t('vault')}
            right={
              <PressScale onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
                <Bell color={ui.text} size={24} />
              </PressScale>
            }
          />

          {/* Category filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
            {['All', ...CATEGORIES.map((c) => c.key)].map((key) => {
              const active = filter === key;
              return (
                <PressScale key={key} testID={`vault-filter-${key}`} onPress={() => setFilter(key)} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{key === 'All' ? t('vault_all') : t(key.toLowerCase())}</Text>
                </PressScale>
              );
            })}
          </ScrollView>

          {/* Storage summary */}
          <Card style={styles.storageCard}>
            <IconTile bg={ui.orangeSoft} size={52} radius={16}>
              <Folder color={ui.orange} size={24} />
            </IconTile>
            <View style={{ flex: 1 }}>
              <Text style={styles.storageText}>{docs.length} {docs.length === 1 ? t('vault_document') : t('vault_documents')} · {usedLabel} {t('vault_of')} {limitMb >= 1024 ? `${(limitMb / 1024).toFixed(0)} GB` : `${limitMb.toFixed(0)} MB`}</Text>
              <View style={{ marginTop: 10 }}>
                <ProgressBar pct={storagePct} />
              </View>
            </View>
          </Card>

          {/* Recent documents */}
          <View style={styles.recentHead}>
            <Text style={styles.recentTitle}>{t('vault_recent_documents')}</Text>
            <Text style={styles.recentTotal}>{filtered.length} {t('vault_total')}</Text>
          </View>

          {filtered.length === 0 && !loading ? (
            <Card style={styles.emptyCard}>
              <IconTile bg={ui.soft} size={52} radius={16}><FileText color={ui.muted} size={24} /></IconTile>
              <Text style={styles.emptyTitle}>{filter === 'All' ? t('no_docs') : `${t('vault_no')} ${t(filter.toLowerCase())} ${t('vault_documents')}`}</Text>
              <Text style={styles.emptySub}>{t('vault_empty_sub')}</Text>
              <PressScale testID="vault-empty-add" onPress={openAdd} style={styles.emptyBtn}>
                <Plus color="#FFFFFF" size={18} />
                <Text style={styles.emptyBtnText}>{t('add_document')}</Text>
              </PressScale>
            </Card>
          ) : (
            <View style={styles.grid}>
              {filtered.map((d) => {
                const cat = catInfo(d.category);
                return (
                  <PressScale key={d.doc_id} testID={`vault-doc-${d.doc_id}`} onPress={() => setPreview(d)} style={styles.tile}>
                    <View style={styles.thumbWrap}>
                      <Image source={{ uri: d.image_base64 }} style={styles.thumbImg} />
                      <View style={styles.moreBtn}>
                        <MoreVertical color={ui.muted} size={16} />
                      </View>
                    </View>
                    <View style={styles.tileBody}>
                      <Badge label={d.category.toUpperCase()} bg={cat.soft} color={cat.tone} />
                      <Text style={styles.tileTitle} numberOfLines={2}>{d.title}</Text>
                      <Text style={styles.tileDate}>{updatedLine(d.created_at, t)}</Text>
                    </View>
                  </PressScale>
                );
              })}
            </View>
          )}
          {/* Shopping List */}
          <View style={styles.recentHead}>
            <View style={styles.shopHeaderLeft}>
              <ShoppingCart color={ui.orange} size={20} />
              <Text style={styles.recentTitle}>{t('vault_shopping_list')}</Text>
            </View>
            {checkedItems.length > 0 ? (
              <PressScale onPress={clearChecked} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>{t('vault_clear_done')}</Text>
              </PressScale>
            ) : (
              <Text style={styles.recentTotal}>{shopItems.length} {shopItems.length === 1 ? t('vault_item') : t('vault_items')}</Text>
            )}
          </View>

          <View style={styles.shopCard}>
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

            {uncheckedItems.map((item) => (
              <PressScale key={item.item_id} onPress={() => toggleShopItem(item)} style={styles.shopRow}>
                <Circle color={ui.muted} size={20} />
                <Text style={styles.shopItemText}>{item.name}</Text>
                <Text style={styles.shopCat}>{item.category}</Text>
                <PressScale onPress={() => deleteShopItem(item.item_id)} style={{ padding: 4 }}>
                  <Trash2 color={ui.muted} size={15} />
                </PressScale>
              </PressScale>
            ))}

            {checkedItems.length > 0 ? (
              <>
                <View style={styles.shopDivider}>
                  <Text style={styles.shopDividerText}>{t('vault_done')} ({checkedItems.length})</Text>
                </View>
                {checkedItems.map((item) => (
                  <PressScale key={item.item_id} onPress={() => toggleShopItem(item)} style={styles.shopRow}>
                    <Check color={ui.mintText} size={20} />
                    <Text style={[styles.shopItemText, styles.shopItemDone]}>{item.name}</Text>
                    <PressScale onPress={() => deleteShopItem(item.item_id)} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </PressScale>
                ))}
              </>
            ) : null}

            {shopItems.length === 0 ? (
              <Text style={styles.shopEmpty}>{t('vault_shop_empty')}</Text>
            ) : null}
          </View>

          {/* Meal Planner */}
          <View style={styles.recentHead}>
            <View style={styles.shopHeaderLeft}>
              <UtensilsCrossed color={ui.lavenderText} size={20} />
              <Text style={styles.recentTitle}>{t('vault_meal_planner')}</Text>
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
          <View style={styles.shopCard}>
            {DAYS.filter((d) => (mealsByDay[d] || []).length > 0).map((day) => (
              <View key={day}>
                <Text style={styles.mealDayLabel}>{day.charAt(0).toUpperCase() + day.slice(1)}</Text>
                {mealsByDay[day].map((meal) => (
                  <View key={meal.meal_id} style={styles.shopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shopItemText}>{meal.title}</Text>
                      {meal.ingredients.length > 0 ? <Text style={styles.shopCat}>{meal.ingredients.join(', ')}</Text> : null}
                    </View>
                    <PressScale onPress={() => deleteMeal(meal.meal_id)} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
              </View>
            ))}
            {meals.length === 0 ? (
              <Text style={styles.shopEmpty}>{t('vault_meal_empty')}</Text>
            ) : null}
          </View>

          {/* Document Expiry Alerts */}
          {expiryAlerts.length > 0 ? (
            <>
              <View style={styles.recentHead}>
                <View style={styles.shopHeaderLeft}>
                  <AlertTriangle color="#DC2626" size={20} />
                  <Text style={styles.recentTitle}>{t('vault_expiry_alerts')}</Text>
                </View>
                <Text style={styles.recentTotal}>{expiryAlerts.length} {expiryAlerts.length === 1 ? t('vault_alert') : t('vault_alerts')}</Text>
              </View>
              <View style={styles.shopCard}>
                {expiryAlerts.slice(0, 6).map((alert) => (
                  <View key={alert.doc_id} style={styles.shopRow}>
                    <View style={[styles.expiryDot, { backgroundColor: alert.status === 'expired' ? '#DC2626' : alert.status === 'urgent' ? '#F59E0B' : ui.mintText }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shopItemText}>{alert.title}</Text>
                      <Text style={styles.shopCat}>
                        {alert.status === 'expired' ? `${t('vault_expired')} ${Math.abs(alert.days_left)} ${t('vault_days_ago')}` : `${alert.days_left} ${t('vault_days_left')}`} · {alert.category}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <View style={{ height: 140 }} />
      </TabScreen>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={openAdd}
        testID="vault-add"
      >
        <Plus color="#FFFFFF" size={28} />
      </Pressable>

      <KeyboardAwareBottomSheet visible={showAdd} onClose={closeAdd} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('add_document')}</Text>
          <PressScale testID="vault-close" onPress={closeAdd} style={styles.iconBtn}>
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('title')}</Text>
        <TextInput testID="vault-title" value={title} onChangeText={setTitle} placeholder={t('title')} placeholderTextColor={ui.muted} style={styles.input} returnKeyType="next" />

        <Text style={styles.label}>{t('doc_category')}</Text>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.key;
            return (
              <PressScale key={c.key} testID={`vault-cat-${c.key}`} onPress={() => setCategory(c.key)} style={[styles.catBtn, { borderColor: active ? c.tone : ui.line, backgroundColor: active ? c.soft : ui.soft }]}>
                <Icon color={active ? c.tone : ui.muted} size={15} />
                <Text style={[styles.catBtnLabel, { color: active ? c.tone : ui.muted }]}>{t(c.key.toLowerCase())}</Text>
              </PressScale>
            );
          })}
        </View>

        <PressScale testID="vault-pick" onPress={pickImage} style={styles.pick}>
          {image ? <Image source={{ uri: image }} style={styles.pickImg} /> : <Text style={styles.pickText}>{t('vault_pick_document_image')}</Text>}
        </PressScale>

        <View style={styles.sheetFooter}>
          <PressScale testID="vault-cancel" onPress={closeAdd} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale testID="vault-save" onPress={save} disabled={saving || !title.trim() || !image} style={[styles.saveBtn, (!title.trim() || !image || saving) && { opacity: 0.5 }]}>
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

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

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.backdrop} />
        {preview ? (
          <View style={styles.previewWrap}>
            <View style={styles.previewTop}>
              <Text style={styles.previewTitle}>{preview.title}</Text>
              <View style={styles.previewActions}>
                <PressScale testID="preview-delete" onPress={() => confirmRemove(preview)} style={styles.previewIconBtn}>
                  <Trash2 color="#EF4444" size={20} />
                </PressScale>
                <PressScale testID="preview-close" onPress={() => setPreview(null)} style={styles.previewIconBtn}>
                  <X color="#fff" size={20} />
                </PressScale>
              </View>
            </View>
            <Image source={{ uri: preview.image_base64 }} style={styles.previewImg} />
          </View>
        ) : null}
      </Modal>

      <LoadingOverlay visible={loading} label={t('vault_loading')} />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  chipScroll: { marginTop: 18, marginHorizontal: -20 },
  chipRow: { gap: 9, paddingHorizontal: 20 },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 99, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line },
  chipActive: { backgroundColor: ui.text, borderColor: ui.text },
  chipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 14 },
  chipTextActive: { color: '#FFFFFF' },

  storageCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 16 },
  storageText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },

  recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 14 },
  recentTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  recentTotal: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  tile: { width: '48%', borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, overflow: 'hidden', shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2, marginBottom: 2 },
  thumbWrap: { height: 132, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  moreBtn: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  tileBody: { padding: 12, gap: 7 },
  tileTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, lineHeight: 19 },
  tileDate: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },

  emptyCard: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 22, gap: 10 },
  emptyTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, textAlign: 'center' },
  emptySub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyBtn: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ui.orange, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 99 },
  emptyBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  fab: { position: 'absolute', right: 22, bottom: 102, width: 61, height: 61, borderRadius: 999, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 7, zIndex: 30 },
  fabPressed: { backgroundColor: '#D9530F', transform: [{ scale: 0.96 }] },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.5)' },
  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  label: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  catBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9999, borderWidth: 1 },
  catBtnLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  pick: { marginTop: 18, height: 150, borderRadius: 18, borderWidth: 1, borderColor: ui.line, borderStyle: 'dashed', backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  pickText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orange },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  previewWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  previewTitle: { flex: 1, color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  previewActions: { flexDirection: 'row', gap: 8 },
  previewIconBtn: { padding: 10, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(15,23,42,0.55)' },
  previewImg: { width: '100%', aspectRatio: 0.75, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },

  shopHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: ui.mint },
  clearBtnText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12 },
  shopCard: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, padding: 14, gap: 4 },
  shopInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  shopInput: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.text, backgroundColor: ui.soft },
  shopAddBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  shopItemText: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  shopItemDone: { textDecorationLine: 'line-through', color: ui.muted },
  shopCat: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },
  shopDivider: { marginTop: 8, paddingVertical: 4 },
  shopDividerText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  shopEmpty: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', paddingVertical: 14 },
  mealDayLabel: { color: ui.lavenderText, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 2 },
  mealDayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  mealDayChipActive: { backgroundColor: ui.lavender, borderColor: ui.lavenderText },
  mealDayChipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, textTransform: 'capitalize' },
  mealDayChipTextActive: { color: ui.lavenderText },
  expiryDot: { width: 10, height: 10, borderRadius: 99 },
});
