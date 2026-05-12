import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { AmbientBackground } from './AmbientBackground';
import { PressScale } from './PressScale';
import { useStore } from '../store';

type Section = {
  title: string;
  body: string | string[];
};

interface LegalPageProps {
  title: string;
  subtitle: string;
  updatedAt: string;
  sections: Section[];
  footer?: string;
}

export function LegalPage({ title, subtitle, updatedAt, sections, footer }: LegalPageProps) {
  const router = useRouter();
  const { theme, user } = useStore();

  const goBack = () => {
    if (router.canGoBack?.()) router.back();
    else router.replace(user ? '/(tabs)/settings' : '/');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}> 
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <PressScale testID="legal-back" onPress={goBack} style={[styles.backBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}> 
            <ArrowLeft color={theme.colors.text} size={16} />
            <Text style={[styles.backText, { color: theme.colors.text }]}>Back</Text>
          </PressScale>

          <Text style={[styles.eyebrow, { color: theme.colors.accent }]}>Household COO</Text>
          <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>{subtitle}</Text>
          <Text style={[styles.updated, { color: theme.colors.textSoft }]}>Last updated: {updatedAt}</Text>

          {sections.map((section) => (
            <View key={section.title} style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}> 
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{section.title}</Text>
              {Array.isArray(section.body) ? (
                section.body.map((item) => (
                  <View key={item} style={styles.bulletRow}>
                    <Text style={[styles.bullet, { color: theme.colors.accent }]}>•</Text>
                    <Text style={[styles.body, { color: theme.colors.textMuted }]}>{item}</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.body, { color: theme.colors.textMuted }]}>{section.body}</Text>
              )}
            </View>
          ))}

          {footer ? <Text style={[styles.footer, { color: theme.colors.textSoft }]}>{footer}</Text> : null}
          <View style={{ height: 80 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingTop: 18 },
  backBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 26,
  },
  backText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  eyebrow: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.3 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 38, lineHeight: 43, letterSpacing: -0.8, marginTop: 8 },
  subtitle: { fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24, marginTop: 10 },
  updated: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 12, marginBottom: 10 },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    marginTop: 14,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 19, lineHeight: 25, marginBottom: 8 },
  body: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 23 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6 },
  bullet: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 23 },
  footer: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 24 },
});
