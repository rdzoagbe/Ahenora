import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Mic, MicOff, Sparkles, Square, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, CardType, logEvent } from '../api';
import { logger } from '../logger';
import { canRecord, fileForUpload, VoiceRecording } from '../voiceRecorder';

interface Draft {
  transcript: string;
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onDraft: (draft: Draft) => void;
  /** Called when the words cannot be recovered, so the composer opens empty
   *  rather than the thought being lost with an error toast. */
  onFallbackToTyping?: () => void;
}

/**
 * Say it, and it becomes a task.
 *
 * The backend has done this the whole time — /api/voice/transcribe transcribes,
 * drafts, picks an assignee from the family's real names, and meters the call
 * against the AI allowance. The only missing piece was a microphone, which is
 * why this file was a "coming soon" panel for so long.
 *
 * It still is, on a binary compiled before expo-audio existed: see
 * ../voiceRecorder, which loads the native module at runtime instead of
 * importing it, so one JS bundle serves builds that can record and builds that
 * cannot. `canRecord()` is the whole difference.
 *
 * Tap to start, tap to stop — not press-and-hold. Hold is fine on a chat
 * bubble you can see; inside a modal it produces half-second recordings from
 * anyone whose thumb slips, and a half-second recording is a wasted AI scan
 * and an error message.
 */

type Phase = 'idle' | 'recording' | 'working' | 'error';

const MAX_SECONDS = 60;

export function VoiceCaptureModal({ visible, onClose, onDraft, onFallbackToTyping }: Props) {
  const { t, theme } = useStore();
  const supported = canRecord();

  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [canType, setCanType] = useState(false);

  const recording = useRef<VoiceRecording | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTicker = () => {
    if (ticker.current) { clearInterval(ticker.current); ticker.current = null; }
  };

  // Leaving the sheet must release the microphone. Without this, backgrounding
  // mid-recording leaves the mic indicator on — which reads as an app that
  // listens when you are not looking, and is the exact opposite of the promise
  // the app makes about privacy.
  useEffect(() => {
    if (!visible) {
      clearTicker();
      recording.current?.cancel();
      recording.current = null;
      setPhase('idle');
      setSeconds(0);
      setError(null);
      setCanType(false);
    }
  }, [visible]);

  useEffect(() => () => { clearTicker(); recording.current?.cancel(); }, []);

  const fail = useCallback((message: string, offerTyping = true) => {
    clearTicker();
    setError(message);
    setCanType(offerTyping);
    setPhase('error');
  }, []);

  const stopAndSend = useCallback(async () => {
    clearTicker();
    setPhase('working');
    const rec = recording.current;
    recording.current = null;
    const uri = rec ? await rec.stop() : null;

    if (!uri) { fail(t('voice_err_failed')); return; }

    try {
      const file = await fileForUpload(uri);
      const draft = await api.voiceTranscribe(file);
      logEvent('voice_used');
      onDraft(draft);
    } catch (e: any) {
      // Out of AI allowance. The scan path already decided how this should
      // feel: you do not lose what you were doing and you are not shown a
      // paywall — you are told, and handed the manual route.
      if (e?.status === 402) { fail(t('voice_err_no_allowance')); return; }
      if (e?.status === 400) { fail(t('voice_err_too_short')); return; }
      logger.warn('voice transcribe failed', e);
      fail(t('voice_err_failed'));
    }
  }, [fail, onDraft, t]);

  const start = useCallback(async () => {
    setError(null);
    const rec = new VoiceRecording();
    const permission = await rec.ensurePermission();
    if (permission === 'denied') { fail(t('voice_err_denied'), false); return; }
    if (permission !== 'ok') { fail(t('voice_err_failed')); return; }

    const started = await rec.start();
    if (started !== 'ok') { fail(t('voice_err_failed')); return; }

    recording.current = rec;
    setSeconds(0);
    setPhase('recording');
    ticker.current = setInterval(() => {
      setSeconds((s) => {
        // A hard ceiling, because a forgotten recording is a large upload and a
        // large bill. It stops itself rather than failing at the server.
        if (s + 1 >= MAX_SECONDS) { stopAndSend(); return MAX_SECONDS; }
        return s + 1;
      });
    }, 1000);
  }, [fail, stopAndSend, t]);

  const c = theme.colors;
  const clock = `0:${String(seconds).padStart(2, '0')}`;

  const body = () => {
    if (!supported) {
      return (
        <>
          <View style={[styles.iconHero, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
            <MicOff color={c.textMuted} size={34} />
          </View>
          <Text style={[styles.heading, { color: c.text }]}>{t('voice_coming_soon')}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>{t('voice_needs_update')}</Text>
          <PressScale testID="voice-coming-soon-close" onPress={onClose} style={[styles.closeBtn, { backgroundColor: c.primary }]}>
            <Text style={[styles.closeText, { color: c.primaryText }]}>{t('voice_got_it')}</Text>
          </PressScale>
        </>
      );
    }

    if (phase === 'working') {
      return (
        <>
          <View style={[styles.iconHero, { backgroundColor: c.accentSoft, borderColor: c.cardBorder }]}>
            <ActivityIndicator color={c.accent} size="large" />
          </View>
          <Text style={[styles.heading, { color: c.text }]}>{t('voice_working')}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>{t('voice_working_sub')}</Text>
        </>
      );
    }

    if (phase === 'error') {
      return (
        <>
          <View style={[styles.iconHero, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
            <MicOff color={c.textMuted} size={34} />
          </View>
          <Text style={[styles.heading, { color: c.text }]}>{error}</Text>
          {canType ? (
            <PressScale
              testID="voice-type-instead"
              onPress={() => { onClose(); onFallbackToTyping?.(); }}
              style={[styles.closeBtn, { backgroundColor: c.primary }]}
            >
              <Text style={[styles.closeText, { color: c.primaryText }]}>{t('voice_type_instead')}</Text>
            </PressScale>
          ) : null}
          <PressScale testID="voice-retry" onPress={() => { setPhase('idle'); setError(null); }} style={styles.linkBtn}>
            <Text style={[styles.linkText, { color: c.textMuted }]}>{t('voice_try_again')}</Text>
          </PressScale>
        </>
      );
    }

    if (phase === 'recording') {
      return (
        <>
          <View style={[styles.iconHero, styles.live, { backgroundColor: c.accentSoft, borderColor: c.accent }]}>
            <Mic color={c.accent} size={34} />
          </View>
          <Text style={[styles.clock, { color: c.text }]}>{clock}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>{t('voice_listening')}</Text>
          <PressScale testID="voice-stop" onPress={stopAndSend} style={[styles.closeBtn, { backgroundColor: c.primary }]}>
            <Square color={c.primaryText} size={15} fill={c.primaryText} />
            <Text style={[styles.closeText, { color: c.primaryText }]}>{t('voice_stop')}</Text>
          </PressScale>
        </>
      );
    }

    return (
      <>
        <View style={[styles.iconHero, { backgroundColor: c.accentSoft, borderColor: c.cardBorder }]}>
          <Mic color={c.accent} size={34} />
        </View>
        <Text style={[styles.heading, { color: c.text }]}>{t('voice_ready')}</Text>
        <Text style={[styles.sub, { color: c.textMuted }]}>{t('voice_ready_sub')}</Text>
        <PressScale testID="voice-start" onPress={start} style={[styles.closeBtn, { backgroundColor: c.primary }]}>
          <Mic color={c.primaryText} size={16} />
          <Text style={[styles.closeText, { color: c.primaryText }]}>{t('voice_start')}</Text>
        </PressScale>
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />

      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: c.accentSoft, borderColor: c.cardBorder }]}>
              <Sparkles color={c.accent} size={12} />
              <Text style={[styles.badgeText, { color: c.text }]}>{t('voice_capture')}</Text>
            </View>

            <PressScale
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              testID="voice-close"
              onPress={onClose}
              style={[styles.iconBtn, { borderColor: c.cardBorder }]}
            >
              <X color={c.text} size={18} />
            </PressScale>
          </View>

          {body()}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Spelled out rather than spreading StyleSheet.absoluteFill: that constant is
  // an opaque registered style, so spreading it yields nothing and the scrim
  // ends up with no position and no size. Same trap as MoreSheet's.
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(8,9,16,0.54)',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 380, borderRadius: 24, borderWidth: 1, padding: 22, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 18 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  iconBtn: { padding: 7, borderRadius: 999, borderWidth: 1 },
  iconHero: { width: 84, height: 84, borderRadius: 42, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  live: { borderWidth: 2.5 },
  heading: { fontFamily: 'Inter_800ExtraBold', fontSize: 19, textAlign: 'center', letterSpacing: -0.2 },
  clock: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 20, paddingVertical: 13, paddingHorizontal: 26, borderRadius: 999, minWidth: 180,
  },
  closeText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  linkBtn: { marginTop: 12, padding: 6 },
  linkText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
