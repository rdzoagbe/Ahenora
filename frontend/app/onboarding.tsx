import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowRight, Check, ListChecks, Plus, ShoppingCart, Sparkles, UserPlus, X } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { useStore } from '../src/store';
import { api, logEvent } from '../src/api';
import { LANG_NAMES, SUPPORTED_LANGS } from '../src/i18n';
import type { Lang } from '../src/i18n';
import { logger } from '../src/logger';

// Guided, account-seeding onboarding: by the time the user lands on the
// dashboard it already has a task, a shopping list and (optionally) a co-parent
// invited — so they hit a "first success" instead of an empty screen. Every
// step is optional; whatever they leave filled gets seeded at finish.
export default function Onboarding() {
  const router = useRouter();
  const { user, loading, theme, lang, setLang, refreshUser, t } = useStore();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const [step, setStep] = useState(0);
  const [taskTitle, setTaskTitle] = useState('');
  const [shopItems, setShopItems] = useState<string[]>(['', '', '']);
  const [shopDraft, setShopDraft] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [finishing, setFinishing] = useState(false);

  const firstName = (user?.name || '').split(' ')[0];

  // Prefill example content once we know the user's language (mockup: "Buy
  // groceries" + Milk/Bread/Eggs). Editable + removable; only non-empty seeds.
  useEffect(() => {
    setTaskTitle(t('ob_task_example'));
    setShopItems([t('ob_shop_ex_1'), t('ob_shop_ex_2'), t('ob_shop_ex_3')]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // If somehow reached without a session, bounce to landing.
  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  const pickLanguage = (l: Lang) => {
    setLang(l).catch((e) => logger.warn('onboarding setLang failed', e));
  };

  const updateShop = (index: number, value: string) =>
    setShopItems((prev) => prev.map((c, i) => (i === index ? value : c)));
  const removeShop = (index: number) => setShopItems((prev) => prev.filter((_, i) => i !== index));
  const addShopDraft = () => {
    const v = shopDraft.trim();
    if (!v) return;
    setShopItems((prev) => [...prev, v]);
    setShopDraft('');
  };

  const goFeed = () => router.replace('/(tabs)/feed');

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);

    // Seed whatever the user left filled. Each is best-effort — one failure
    // never blocks the others or the flag.
    const title = taskTitle.trim();
    if (title) {
      try { await api.createCard({ type: 'TASK', title }); }
      catch (e) { logger.warn('onboarding seed task failed', e); }
    }
    const names = shopItems.map((n) => n.trim()).filter(Boolean);
    if (names.length) {
      try { await api.bulkAddShopping(names); }
      catch (e) { logger.warn('onboarding seed shopping failed', e); }
    }
    const email = inviteEmail.trim();
    if (email && /\S+@\S+\.\S+/.test(email)) {
      try { await api.invite(email); }
      catch (e) { logger.warn('onboarding invite failed', e); }
    }

    try {
      // Only mark done — and leave — if the flag actually persists, else the
      // user would land believing setup saved and get re-onboarded next launch.
      await api.completeOnboarding();
      logEvent('onboarding_done');
      await refreshUser().catch(() => undefined);
      goFeed();
    } catch (e) {
      logger.warn('completeOnboarding failed', e);
      Alert.alert(
        t('ob_finish_fail_title'),
        t('ob_finish_fail_msg'),
        [
          { text: t('ob_skip_for_now'), style: 'cancel', onPress: goFeed },
          { text: t('ob_retry'), onPress: () => { setFinishing(false); finish(); } },
        ],
      );
    } finally {
      setFinishing(false);
    }
  };

  const totalSteps = 5;
  const isLast = step === totalSteps - 1;
  const next = () => setStep((s) => Math.min(s + 1, totalSteps - 1));

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Progress dots */}
        <View style={styles.dots}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i <= step ? theme.colors.accent : theme.colors.cardBorder },
                i === step && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Step 0 — welcome + language */}
          {step === 0 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Sparkles color={theme.colors.accent} size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('ob_welcome')}{firstName ? `, ${firstName}` : ''}</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('ob_choose_language')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('ob_language_hint')}</Text>

              <View style={styles.list}>
                {SUPPORTED_LANGS.map((l) => {
                  const active = lang === l;
                  return (
                    <PressScale
                      key={l}
                      testID={`onboarding-lang-${l}`}
                      onPress={() => pickLanguage(l)}
                      style={[styles.row, { backgroundColor: theme.colors.bgSoft, borderColor: active ? theme.colors.accent : theme.colors.cardBorder }]}
                    >
                      <Text style={[styles.rowText, { color: theme.colors.text }]}>{LANG_NAMES[l]}</Text>
                      {active ? <Check color={theme.colors.accent} size={18} /> : null}
                    </PressScale>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Step 1 — first task */}
          {step === 1 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <ListChecks color={theme.colors.accent} size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('ob_step_of', { n: 2, total: 5 })}</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('ob_task_title')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('ob_task_hint')}</Text>
              <View style={[styles.inputRow, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <TextInput
                  testID="onboarding-task"
                  value={taskTitle}
                  onChangeText={setTaskTitle}
                  placeholder={t('ob_task_example')}
                  placeholderTextColor={theme.colors.textSoft}
                  style={[styles.input, { color: theme.colors.text }]}
                />
              </View>
            </View>
          ) : null}

          {/* Step 2 — shopping list */}
          {step === 2 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <ShoppingCart color={theme.colors.accent} size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('ob_step_of', { n: 3, total: 5 })}</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('ob_shop_title')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('ob_shop_hint')}</Text>
              <View style={styles.list}>
                {shopItems.map((name, i) => (
                  <View key={i} style={[styles.inputRow, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                    <TextInput
                      testID={`onboarding-shop-${i}`}
                      value={name}
                      onChangeText={(v) => updateShop(i, v)}
                      placeholder={t('ob_shop_placeholder')}
                      placeholderTextColor={theme.colors.textSoft}
                      style={[styles.input, { color: theme.colors.text }]}
                    />
                    <PressScale onPress={() => removeShop(i)} style={{ padding: 6 }}>
                      <X color={theme.colors.textSoft} size={16} />
                    </PressScale>
                  </View>
                ))}
                <View style={[styles.inputRow, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                  <TextInput
                    testID="onboarding-shop-draft"
                    value={shopDraft}
                    onChangeText={setShopDraft}
                    onSubmitEditing={addShopDraft}
                    placeholder={t('ob_shop_placeholder')}
                    placeholderTextColor={theme.colors.textSoft}
                    style={[styles.input, { color: theme.colors.text }]}
                    returnKeyType="done"
                  />
                  <PressScale onPress={addShopDraft} style={[styles.addBtn, { backgroundColor: theme.colors.primary }]}>
                    <Plus color={theme.colors.primaryText} size={16} />
                  </PressScale>
                </View>
              </View>
            </View>
          ) : null}

          {/* Step 3 — invite a family member */}
          {step === 3 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <UserPlus color={theme.colors.accent} size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('ob_step_of', { n: 4, total: 5 })}</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('ob_invite_title')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('ob_invite_hint')}</Text>
              <View style={[styles.inputRow, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <TextInput
                  testID="onboarding-invite"
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder={t('ob_invite_placeholder')}
                  placeholderTextColor={theme.colors.textSoft}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={[styles.input, { color: theme.colors.text }]}
                />
              </View>
            </View>
          ) : null}

          {/* Step 4 — you're ready */}
          {step === 4 ? (
            <View style={styles.readyWrap}>
              <View style={[styles.readyIcon, { backgroundColor: theme.colors.primary }]}>
                <Sparkles color={theme.colors.primaryText} size={30} />
              </View>
              <Text style={[styles.title, { color: theme.colors.text, textAlign: 'center' }]}>{t('ob_ready_title')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted, textAlign: 'center' }]}>{t('ob_ready_hint')}</Text>
              <View style={styles.chips}>
                {taskTitle.trim() ? <SummaryChip label={t('ob_chip_task')} c={theme.colors} /> : null}
                {shopItems.some((s) => s.trim()) ? <SummaryChip label={t('ob_chip_shopping')} c={theme.colors} /> : null}
                {inviteEmail.trim() ? <SummaryChip label={t('ob_chip_invite')} c={theme.colors} /> : null}
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* Footer actions */}
        <View style={styles.footer}>
          {!isLast ? (
            <PressScale testID="onboarding-skip" onPress={next} style={styles.skipBtn}>
              <Text style={[styles.skipText, { color: theme.colors.textMuted }]}>{t('ob_skip_for_now')}</Text>
            </PressScale>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <PressScale
            testID="onboarding-continue"
            onPress={isLast ? finish : next}
            disabled={finishing}
            style={[styles.nextBtn, { backgroundColor: theme.colors.primary }, finishing && { opacity: 0.6 }]}
          >
            <Text style={[styles.nextText, { color: theme.colors.primaryText }]}>
              {isLast ? (finishing ? t('ob_setting_up') : t('ob_go_dashboard')) : t('ob_continue')}
            </Text>
            {!isLast ? <ArrowRight color={theme.colors.primaryText} size={16} /> : null}
          </PressScale>
        </View>
      </SafeAreaView>
    </View>
  );
}

function SummaryChip({ label, c }: { label: string; c: any }) {
  return (
    <View style={[chipStyles.chip, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
      <Check color={c.accent} size={13} />
      <Text style={[chipStyles.text, { color: c.text }]}>{label}</Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, borderWidth: 1 },
  text: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});

const createStyles = (c: any) =>
  StyleSheet.create({
    container: { flex: 1 },
    safe: { flex: 1, paddingHorizontal: 22 },
    dots: { flexDirection: 'row', gap: 8, justifyContent: 'center', paddingTop: 14, paddingBottom: 6 },
    dot: { width: 8, height: 8, borderRadius: 9999 },
    dotActive: { width: 22 },
    scroll: { paddingTop: 24, paddingBottom: 20 },
    badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9999, borderWidth: 1, marginBottom: 16 },
    badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
    title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 38, lineHeight: 44 },
    sub: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 8 },
    list: { marginTop: 18, gap: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderRadius: 16, borderWidth: 1 },
    rowText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
    inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, marginTop: 12 },
    input: { flex: 1, paddingVertical: 15, fontFamily: 'Inter_500Medium', fontSize: 16 },
    addBtn: { width: 34, height: 34, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
    readyWrap: { alignItems: 'center', paddingTop: 40, gap: 4 },
    readyIcon: { width: 84, height: 84, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 22 },
    footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
    skipBtn: { paddingVertical: 14, paddingHorizontal: 10 },
    skipText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    nextBtn: { flex: 1, height: 54, borderRadius: 9999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    nextText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  });
