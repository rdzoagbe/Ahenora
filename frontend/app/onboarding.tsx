import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowRight, Check, Crown, Plus, Sparkles, Trash2, Users } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { useStore } from '../src/store';
import { api } from '../src/api';
import { LANG_NAMES, SUPPORTED_LANGS } from '../src/i18n';
import type { Lang } from '../src/i18n';
import { logger } from '../src/logger';

export default function Onboarding() {
  const router = useRouter();
  const { user, loading, theme, lang, setLang, refreshUser } = useStore();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const [step, setStep] = useState(0);
  const [childNames, setChildNames] = useState<string[]>(['']);
  const [finishing, setFinishing] = useState(false);

  // If somehow reached without a session, bounce to landing.
  useEffect(() => {
    if (!loading && !user) router.replace('/');
  }, [loading, user, router]);

  const firstName = (user?.name || '').split(' ')[0];

  const pickLanguage = (l: Lang) => {
    // setLang persists to the backend and updates the UI immediately.
    setLang(l).catch((e) => logger.warn('onboarding setLang failed', e));
  };

  const updateChild = (index: number, value: string) =>
    setChildNames((prev) => prev.map((c, i) => (i === index ? value : c)));
  const addChildRow = () => setChildNames((prev) => [...prev, '']);
  const removeChildRow = (index: number) =>
    setChildNames((prev) => (prev.length === 1 ? [''] : prev.filter((_, i) => i !== index)));

  const goFeed = () => router.replace('/(tabs)/feed');

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      const names = childNames.map((n) => n.trim()).filter(Boolean);

      // Dedupe against members already on the server so a retry (or a repeated
      // run after a previous failure) never creates duplicate children.
      let existing = new Set<string>();
      try {
        const members = await api.familyMembers();
        existing = new Set(members.map((m) => m.name.trim().toLowerCase()));
      } catch (e) {
        logger.warn('onboarding member fetch failed', e);
      }

      let addFailed = false;
      for (const name of names) {
        if (existing.has(name.toLowerCase())) continue;
        try {
          await api.createFamilyMember({ name });
          existing.add(name.toLowerCase());
        } catch (e) {
          logger.warn('onboarding add child failed', e);
          addFailed = true;
        }
      }

      // Only mark onboarding done — and leave the screen — if the flag actually
      // persists. Otherwise the user would land in the app believing setup
      // saved (it didn't) and get re-onboarded next launch.
      await api.completeOnboarding();
      await refreshUser().catch(() => undefined);

      if (addFailed) {
        Alert.alert(
          'Almost there',
          "You're all set, but we couldn't add every child. You can add them anytime in Settings.",
          [{ text: 'OK', onPress: goFeed }],
        );
      } else {
        goFeed();
      }
    } catch (e) {
      // completeOnboarding failed — do NOT navigate away (avoids a fake
      // success + a re-onboarding loop). Let the user retry or skip.
      logger.warn('completeOnboarding failed', e);
      Alert.alert(
        "Couldn't finish setup",
        'Please check your connection and try again.',
        [
          { text: 'Skip for now', style: 'cancel', onPress: goFeed },
          { text: 'Retry', onPress: () => { setFinishing(false); finish(); } },
        ],
      );
    } finally {
      setFinishing(false);
    }
  };

  const totalSteps = 3;

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

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {step === 0 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Sparkles color={theme.colors.accent} size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>Welcome{firstName ? `, ${firstName}` : ''}</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>Choose your language</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>You can change this anytime in Settings.</Text>

              <View style={styles.langList}>
                {SUPPORTED_LANGS.map((l) => {
                  const active = lang === l;
                  return (
                    <PressScale
                      key={l}
                      testID={`onboarding-lang-${l}`}
                      onPress={() => pickLanguage(l)}
                      style={[
                        styles.langRow,
                        { backgroundColor: theme.colors.bgSoft, borderColor: active ? theme.colors.accent : theme.colors.cardBorder },
                      ]}
                    >
                      <Text style={[styles.langName, { color: theme.colors.text }]}>{LANG_NAMES[l]}</Text>
                      {active ? <Check color={theme.colors.accent} size={18} /> : null}
                    </PressScale>
                  );
                })}
              </View>
            </View>
          ) : null}

          {step === 1 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Users color={theme.colors.accent} size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>Your household</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>Add your kids</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>Add the children in your household so you can assign chores and track stars. You can skip this and add them later.</Text>

              <View style={styles.childList}>
                {childNames.map((name, i) => (
                  <View key={i} style={[styles.childRow, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                    <TextInput
                      testID={`onboarding-child-${i}`}
                      value={name}
                      onChangeText={(v) => updateChild(i, v)}
                      placeholder="Child's name"
                      placeholderTextColor={theme.colors.textSoft}
                      style={[styles.childInput, { color: theme.colors.text }]}
                    />
                    {childNames.length > 1 || name ? (
                      <PressScale onPress={() => removeChildRow(i)} style={{ padding: 6 }}>
                        <Trash2 color={theme.colors.textSoft} size={16} />
                      </PressScale>
                    ) : null}
                  </View>
                ))}
                <PressScale onPress={addChildRow} style={[styles.addRow, { borderColor: theme.colors.cardBorder }]}>
                  <Plus color={theme.colors.accent} size={16} />
                  <Text style={[styles.addRowText, { color: theme.colors.text }]}>Add another child</Text>
                </PressScale>
              </View>
            </View>
          ) : null}

          {step === 2 ? (
            <View>
              <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Crown color="#F59E0B" size={13} />
                <Text style={[styles.badgeText, { color: theme.colors.text }]}>Your plan</Text>
              </View>
              <Text style={[styles.title, { color: theme.colors.text }]}>You&apos;re all set</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>You&apos;re on the free Village plan — everything you need to start organising your household. More plans are coming soon.</Text>

              <View style={[styles.planCard, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.planName, { color: theme.colors.text }]}>Village · Free</Text>
                {['Up to 3 family members', 'Shared tasks & calendar', 'Kids chores & rewards', 'Secure document vault'].map((f) => (
                  <View key={f} style={styles.planFeatureRow}>
                    <Check color={theme.colors.accent} size={15} />
                    <Text style={[styles.planFeature, { color: theme.colors.textMuted }]}>{f}</Text>
                  </View>
                ))}
              </View>

              <PressScale onPress={() => router.push('/pricing')} style={styles.linkRow}>
                <Text style={[styles.linkText, { color: theme.colors.accent }]}>See all plans</Text>
                <ArrowRight color={theme.colors.accent} size={14} />
              </PressScale>
            </View>
          ) : null}
        </ScrollView>

        {/* Footer actions */}
        <View style={styles.footer}>
          {step < 2 ? (
            <PressScale testID="onboarding-skip" onPress={() => setStep((s) => s + 1)} style={styles.skipBtn}>
              <Text style={[styles.skipText, { color: theme.colors.textMuted }]}>{step === 1 ? 'Skip for now' : 'Skip'}</Text>
            </PressScale>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <PressScale
            testID="onboarding-continue"
            onPress={step < 2 ? () => setStep((s) => s + 1) : finish}
            disabled={finishing}
            style={[styles.nextBtn, { backgroundColor: theme.colors.primary }, finishing && { opacity: 0.6 }]}
          >
            <Text style={[styles.nextText, { color: theme.colors.primaryText }]}>
              {step < 2 ? 'Continue' : finishing ? 'Setting up…' : 'Start organising'}
            </Text>
            {step < 2 ? <ArrowRight color={theme.colors.primaryText} size={16} /> : null}
          </PressScale>
        </View>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (c: any) =>
  StyleSheet.create({
    container: { flex: 1 },
    safe: { flex: 1, paddingHorizontal: 22 },
    dots: { flexDirection: 'row', gap: 8, justifyContent: 'center', paddingTop: 14, paddingBottom: 6 },
    dot: { width: 8, height: 8, borderRadius: 9999 },
    dotActive: { width: 22 },
    scroll: { paddingTop: 24, paddingBottom: 20 },
    badge: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 9999,
      borderWidth: 1,
      marginBottom: 16,
    },
    badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
    title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 38, lineHeight: 44 },
    sub: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 8 },
    langList: { marginTop: 18, gap: 12 },
    langRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderRadius: 16,
      borderWidth: 1,
    },
    langName: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
    childList: { marginTop: 18, gap: 12 },
    childRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, paddingHorizontal: 16 },
    childInput: { flex: 1, paddingVertical: 15, fontFamily: 'Inter_500Medium', fontSize: 16 },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderStyle: 'dashed',
    },
    addRowText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    planCard: { marginTop: 18, borderRadius: 20, borderWidth: 1, padding: 18, gap: 12 },
    planName: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, marginBottom: 2 },
    planFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    planFeature: { fontFamily: 'Inter_500Medium', fontSize: 14 },
    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
    linkText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
    skipBtn: { paddingVertical: 14, paddingHorizontal: 10 },
    skipText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    nextBtn: {
      flex: 1,
      height: 54,
      borderRadius: 9999,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    nextText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  });
