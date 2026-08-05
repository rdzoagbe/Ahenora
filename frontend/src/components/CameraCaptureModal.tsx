import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
  ScrollView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import {
  X, Sparkles, Camera, Image as ImageIcon, FileScan, Check, ChefHat,
} from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, CardType, CapturedRecipe, ScanResult } from '../api';
import { DOCUMENT_CATEGORIES, CATEGORY_STYLE } from '../documentCategories';
import { categoriseShoppingItem, shoppingLabel } from '../shoppingCategories';
import { logger } from '../logger';

interface Draft {
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
  image_base64?: string | null;
  vault_category?: string;
  save_to_vault?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onDraft: (d: Draft & { transcript: string }) => void;
}

type Phase = 'idle' | 'scanning' | 'confirm' | 'recipe' | 'error';

export function CameraCaptureModal({ visible, onClose, onDraft }: Props) {
  const { t, theme } = useStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // What the scan came back with, and what the family decides about it.
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [category, setCategory] = useState<string>('');
  const [recipe, setRecipe] = useState<CapturedRecipe | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPhase('idle');
      setPreview(null);
      setErr(null);
      setScan(null);
      setCategory('');
      setRecipe(null);
      setSkipped(new Set());
      setAdding(false);
    }
  }, [visible]);

  const pick = async (source: 'camera' | 'library') => {
    setErr(null);

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

      const res =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              base64: true,
              quality: 0.55,
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
            })
          : await ImagePicker.launchImageLibraryAsync({
              base64: true,
              quality: 0.55,
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
            });

      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      const imageBase64 = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;

      setPreview(imageBase64);
      setPhase('scanning');

      try {
        const result = await api.visionExtract(imageBase64);
        setScan(result);
        setCategory(result.vault_category || '');
        if (result.kind === 'recipe' && result.recipe) {
          setRecipe(result.recipe);
          setPhase('recipe');
        } else {
          setPhase('confirm');
        }
      } catch (e: any) {
        /**
         * Running out of AI credit must not cost you the photograph.
         *
         * This used to surface as an upgrade wall, which threw away the thing
         * the parent had just taken and asked them for money instead. The
         * manual path was always there; the sorting is what the allowance
         * buys. So the sheet carries on to the same confirm step with nothing
         * pre-selected — the same number of taps, minus the ones the model
         * was saving.
         */
        if (e?.status === 402) {
          setScan(null);
          setCategory('');
          setPhase('confirm');
          return;
        }
        logger.warn('vision extract failed', e);
        setErr(e?.message || t('cam_vision_failed'));
        setPhase('error');
      }
    } catch (e: any) {
      setErr(e?.message || t('cam_could_not_open_camera'));
      setPhase('error');
    }
  };

  /** Hand the document on to the card form, with the drawer the family chose. */
  const continueAsDocument = () => {
    onDraft({
      transcript: '',
      type: scan?.type || 'TASK',
      title: scan?.title || '',
      description: scan?.description || '',
      assignee: scan?.assignee || '',
      due_date: scan?.due_date || null,
      image_base64: preview,
      vault_category: category,
      // Nothing is filed anywhere without a drawer chosen for it. An
      // uncategorised document in the vault is a document nobody finds again.
      save_to_vault: scan?.save_to_vault !== false && !!category,
    });
  };

  const addIngredients = async () => {
    if (!recipe || adding) return;
    const wanted = recipe.ingredients.filter((_, i) => !skipped.has(i));
    if (wanted.length === 0) return;
    setAdding(true);
    const names = wanted.map(shoppingLabel);
    try {
      // An unrecognised ingredient has no aisle; the server files those under
      // "Other" itself, so send nothing rather than a guess.
      await api.bulkAddShopping(
        names,
        wanted.map((i) => categoriseShoppingItem(i.name) ?? undefined),
      );
      onClose();
    } catch (e: any) {
      logger.warn('bulk add from recipe failed', e);
      setErr(e?.message || t('cam_shopping_add_failed'));
      setAdding(false);
    }
  };

  const toggle = (index: number) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const scanning = phase === 'scanning';
  const chosenCount = recipe ? recipe.ingredients.length - skipped.size : 0;
  // Nothing understood — either the model made nothing of it, or the month's
  // AI sorting is spent. Both mean the same thing to the person holding it.
  const unaided = phase === 'confirm' && (!scan || scan.understood === false);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      <View style={[styles.backdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.48)' : 'rgba(8,9,16,0.6)' }]} />
      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}>
              <Sparkles color={theme.colors.accent} size={12} />
              <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('cam_quick_action')}</Text>
            </View>
            <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="cam-close" onPress={onClose} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder }]} disabled={scanning}>
              <X color={theme.colors.text} size={18} />
            </PressScale>
          </View>

          {phase === 'recipe' && recipe ? (
            <>
              <View style={[styles.heroIcon, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <ChefHat color={theme.colors.accent} size={28} />
              </View>
              <Text style={[styles.heading, { color: theme.colors.text }]}>{t('cam_looks_like_recipe')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]} numberOfLines={2}>{recipe.title}</Text>

              <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
                {recipe.ingredients.map((item, index) => {
                  const on = !skipped.has(index);
                  return (
                    <PressScale
                      key={`${item.name}-${index}`}
                      testID={`cam-ingredient-${index}`}
                      accessibilityRole="button"
                      onPress={() => toggle(index)}
                      style={[styles.row, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
                    >
                      <View style={[styles.tick, { borderColor: on ? theme.colors.accent : theme.colors.cardBorder, backgroundColor: on ? theme.colors.accent : 'transparent' }]}>
                        {on ? <Check color={theme.colors.primaryText} size={13} /> : null}
                      </View>
                      <Text
                        style={[styles.rowText, { color: on ? theme.colors.text : theme.colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {shoppingLabel(item)}
                      </Text>
                    </PressScale>
                  );
                })}
              </ScrollView>

              {err ? <Text style={[styles.errText, { color: theme.colors.danger }]}>{err}</Text> : null}

              <View style={styles.controls}>
                <PressScale
                  testID="cam-add-shopping"
                  onPress={addIngredients}
                  disabled={adding || chosenCount === 0}
                  style={[styles.primaryBtn, { backgroundColor: theme.colors.primary, opacity: chosenCount === 0 ? 0.5 : 1 }]}
                >
                  <Text style={[styles.primaryText, { color: theme.colors.primaryText }]}>
                    {adding ? t('cam_adding') : t('cam_add_to_shopping', { count: String(chosenCount) })}
                  </Text>
                </PressScale>
                <PressScale
                  testID="cam-recipe-as-document"
                  onPress={() => { setRecipe(null); setPhase('confirm'); }}
                  style={[styles.secondaryBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
                >
                  <Text style={[styles.secondaryText, { color: theme.colors.text }]}>{t('cam_file_instead')}</Text>
                </PressScale>
              </View>
            </>
          ) : phase === 'confirm' ? (
            <>
              {/* Small, but it has to be here: this step asks the family to
                  agree with a reading of a photograph, and they cannot do
                  that without seeing which photograph. */}
              {preview ? (
                <Image
                  source={{ uri: preview }}
                  style={[styles.thumb, { borderColor: theme.colors.cardBorder }]}
                  accessibilityLabel={t('cam_photo_preview_a11y')}
                />
              ) : null}
              {/* A scanned document title can be a whole sentence; without a
                  cap it wrapped far enough to push the Continue button off a
                  small screen. */}
              <Text style={[styles.heading, { color: theme.colors.text }]} numberOfLines={2}>
                {scan?.title || t('cam_scanned_document')}
              </Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>
                {unaided ? t('cam_pick_yourself') : t('cam_where_does_it_go')}
              </Text>

              {scan?.amount || scan?.due_date ? (
                <View style={[styles.facts, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                  {scan?.amount ? (
                    <Text style={[styles.factText, { color: theme.colors.text }]}>
                      {t('cam_amount_due', { amount: scan.amount })}
                    </Text>
                  ) : null}
                  {scan?.due_date ? (
                    <Text style={[styles.factText, { color: theme.colors.textMuted }]}>
                      {t('cam_by_date', { date: new Date(scan.due_date).toLocaleDateString() })}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.chips}>
                {DOCUMENT_CATEGORIES.map((key) => {
                  const Icon = CATEGORY_STYLE[key].icon;
                  const on = category === key;
                  return (
                    <PressScale
                      key={key}
                      testID={`cam-category-${key}`}
                      accessibilityRole="button"
                      onPress={() => setCategory(on ? '' : key)}
                      style={[
                        styles.chip,
                        {
                          borderColor: on ? theme.colors.accent : theme.colors.cardBorder,
                          backgroundColor: on ? theme.colors.accentSoft : theme.colors.bgSoft,
                        },
                      ]}
                    >
                      <Icon color={on ? theme.colors.accent : theme.colors.textMuted} size={14} />
                      <Text style={[styles.chipText, { color: on ? theme.colors.text : theme.colors.textMuted }]}>
                        {t(key.toLowerCase())}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>

              <View style={styles.controls}>
                <PressScale
                  testID="cam-continue"
                  onPress={continueAsDocument}
                  style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
                >
                  <Text style={[styles.primaryText, { color: theme.colors.primaryText }]}>{t('ob_continue')}</Text>
                </PressScale>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.heroIcon, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <FileScan color={theme.colors.accent} size={28} />
              </View>

              <Text style={[styles.heading, { color: theme.colors.text }]}>{t('cam_smart_scan')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('cam_smart_scan_sub')}</Text>

              <View style={[styles.stage, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                {preview ? (
                  <Image source={{ uri: preview }} style={styles.preview} accessibilityLabel={t('cam_photo_preview_a11y')} />
                ) : (
                  <View style={styles.emptyStage}>
                    <Camera color={theme.colors.textSoft} size={36} />
                    <Text style={[styles.emptyStageText, { color: theme.colors.textMuted }]}>{t('cam_take_or_choose')}</Text>
                  </View>
                )}
                {scanning && (
                  <View style={[styles.overlay, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.84)' : 'rgba(8,9,16,0.76)' }]}>
                    <ActivityIndicator color={theme.colors.text} size="large" />
                    <Text style={[styles.overlayText, { color: theme.colors.text }]}>{t('scanning')}</Text>
                  </View>
                )}
              </View>

              {phase === 'error' && (
                <View style={[styles.errorBox, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.errText, { color: theme.colors.danger }]}>{err}</Text>
                  <Text style={[styles.errHelp, { color: theme.colors.textMuted }]}>{t('cam_error_help')}</Text>
                </View>
              )}

              <View style={styles.controls}>
                <PressScale
                  testID="cam-take"
                  onPress={() => pick('camera')}
                  style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
                  disabled={scanning}
                >
                  <Camera color={theme.colors.primaryText} size={16} />
                  <Text style={[styles.primaryText, { color: theme.colors.primaryText }]}>{t('scan_flyer')}</Text>
                </PressScale>
                <PressScale
                  testID="cam-library"
                  onPress={() => pick('library')}
                  style={[styles.secondaryBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
                  disabled={scanning}
                >
                  <ImageIcon color={theme.colors.text} size={16} />
                  <Text style={[styles.secondaryText, { color: theme.colors.text }]}>{t('choose_photo')}</Text>
                </PressScale>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 9999,
  },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.2 },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1 },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heading: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  stage: {
    height: 210,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 14,
  },
  preview: { width: '100%', height: '100%', resizeMode: 'cover' },
  emptyStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  emptyStageText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 12 },
  errorBox: { borderWidth: 1, borderRadius: 18, padding: 12, marginBottom: 12 },
  errText: { fontFamily: 'Inter_700Bold', fontSize: 13, lineHeight: 19 },
  errHelp: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, marginTop: 4 },
  thumb: {
    width: 76,
    height: 76,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    resizeMode: 'cover',
  },
  facts: { borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 14, gap: 2 },
  factText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  list: { maxHeight: 230, marginBottom: 14 },
  listInner: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  controls: { gap: 10 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  primaryText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  secondaryText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});
