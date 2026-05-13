import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, ScrollView, ActivityIndicator, ImageBackground, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Sparkles, Share2 } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api } from '../api';
import { handlePlanLimitError } from './UpgradeModal';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const BG_URL = 'https://static.prod-images.emergentagent.com/jobs/096ff1e5-0337-4e7f-a0c1-6a43a75126d3/images/c54dfb594feff59886f35731ad1a1d593ce3d04827e4d753eab304e381593173.png';

export function SundayBriefModal({ visible, onClose }: Props) {
  const { t, showUpgradePrompt, theme } = useStore();
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (visible) {
      setBrief(null);
      setGeneratedAt(null);
    }
  }, [visible]);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await api.weeklyBrief();
      setBrief(res.brief);
      setGeneratedAt(res.generated_at);
    } catch (e: any) {
      if (handlePlanLimitError(e, showUpgradePrompt)) {
        onClose();
        return;
      }
      console.log('brief error', e);
      setBrief('Unable to generate brief right now.');
    } finally {
      setLoading(false);
    }
  };

  const light = theme.mode === 'light';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <ImageBackground source={{ uri: BG_URL }} style={StyleSheet.absoluteFill} resizeMode="cover">
        <BlurView intensity={light ? 72 : 60} tint={light ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
        <View style={[styles.overlay, { backgroundColor: light ? 'rgba(255,255,255,0.78)' : 'rgba(8,9,16,0.72)' }]} />
      </ImageBackground>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <PressScale testID="close-brief" onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
            <X color={theme.colors.text} size={18} />
          </PressScale>
        </View>

        <View style={styles.content}>
          <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}> 
            <Sparkles color={theme.colors.accent} size={14} />
            <Text style={[styles.badgeText, { color: theme.colors.accent }]}>AI · Gemini 3 Flash</Text>
          </View>
          <Text style={[styles.heading, { color: theme.colors.text }]}>{t('sunday_brief')}</Text>
          <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('sunday_brief_subtitle')}</Text>

          {!brief && !loading && (
            <PressScale testID="generate-brief" onPress={generate} style={[styles.ctaBtn, { backgroundColor: theme.colors.primary }]}> 
              <Sparkles color={theme.colors.primaryText} size={16} />
              <Text style={[styles.ctaText, { color: theme.colors.primaryText }]}>{t('generate_brief')}</Text>
            </PressScale>
          )}

          {loading && (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.colors.text} />
              <Text style={[styles.loadingText, { color: theme.colors.textMuted }]}>{t('generating')}</Text>
            </View>
          )}

          {brief && (
            <View style={[styles.briefPanel, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}> 
              <ScrollView
                style={styles.briefScroll}
                contentContainerStyle={styles.briefContent}
                testID="brief-scroll"
              >
                <Text style={[styles.briefText, { color: theme.colors.text }]}>{brief}</Text>
                {generatedAt ? (
                  <Text style={[styles.generatedAt, { color: theme.colors.textSoft }]}> 
                    {new Date(generatedAt).toLocaleString()}
                  </Text>
                ) : null}
                <PressScale
                  testID="share-brief"
                  onPress={async () => {
                    const shareText = `Sunday Brief from Household COO\n\n${brief}`;
                    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
                      try {
                        if ((navigator as any).share) {
                          await (navigator as any).share({
                            title: 'Sunday Brief — Household COO',
                            text: shareText,
                          });
                          setShared(true);
                        } else if (navigator.clipboard) {
                          await navigator.clipboard.writeText(shareText);
                          setShared(true);
                        }
                      } catch { /* user cancelled */ }
                    }
                    setTimeout(() => setShared(false), 2200);
                  }}
                  style={[styles.shareBtn, { backgroundColor: theme.colors.primary }]}
                >
                  <Share2 color={theme.colors.primaryText} size={16} />
                  <Text style={[styles.shareText, { color: theme.colors.primaryText }]}> 
                    {shared ? 'Copied / shared!' : 'Share the brief'}
                  </Text>
                </PressScale>
              </ScrollView>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end' },
  closeBtn: {
    padding: 10,
    borderRadius: 9999,
    borderWidth: 1,
  },
  content: { flex: 1, justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 9999,
    marginBottom: 20,
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 48,
    lineHeight: 52,
    marginBottom: 8,
  },
  sub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 9999,
    gap: 8,
  },
  ctaText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  loadingWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadingText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  briefPanel: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    maxHeight: 460,
  },
  briefScroll: { maxHeight: 420 },
  briefContent: { paddingRight: 8 },
  briefText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 27,
    letterSpacing: 0.1,
  },
  generatedAt: {
    marginTop: 20,
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  shareBtn: {
    marginTop: 22,
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 9999,
  },
  shareText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
});
