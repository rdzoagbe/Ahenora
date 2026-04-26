import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Audio } from 'expo-av';
import { Mic, Sparkles, Square, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, CardType } from '../api';

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
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'error';

export function VoiceCaptureModal({ visible, onClose, onDraft }: Props) {
  const { t } = useStore();

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const nativeRecordingRef = useRef<Audio.Recording | null>(null);
  const webRecorderRef = useRef<any>(null);
  const webChunksRef = useRef<Blob[]>([]);
  const webStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) {
      cleanup();
      setPhase('idle');
      setElapsed(0);
      setErrMsg(null);
    }

    return cleanup;
  }, [visible]);

  const cleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (webRecorderRef.current && webRecorderRef.current.state === 'recording') {
      try {
        webRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }

    if (webStreamRef.current) {
      webStreamRef.current.getTracks().forEach((track) => track.stop());
      webStreamRef.current = null;
    }

    if (nativeRecordingRef.current) {
      try {
        nativeRecordingRef.current.stopAndUnloadAsync();
      } catch {
        // ignore
      }
      nativeRecordingRef.current = null;
    }

    webRecorderRef.current = null;
    webChunksRef.current = [];
  };

  const startTimer = () => {
    setElapsed(0);

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startWebRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error(t('not_supported_web'));
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    webStreamRef.current = stream;

    let mimeType = '';

    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      }
    }

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    webChunksRef.current = [];

    recorder.ondataavailable = (event: any) => {
      if (event.data && event.data.size > 0) {
        webChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      stopTimer();

      if (webStreamRef.current) {
        webStreamRef.current.getTracks().forEach((track) => track.stop());
        webStreamRef.current = null;
      }

      const blob = new Blob(webChunksRef.current, {
        type: recorder.mimeType || mimeType || 'audio/ogg',
      });

      if (blob.size < 500) {
        setErrMsg('Recording too short.');
        setPhase('error');
        return;
      }

      setPhase('transcribing');

      try {
        const draft = await api.voiceTranscribe(blob);
        onDraft(draft);
      } catch (err: any) {
        console.log('transcribe error', err);
        setErrMsg(err?.message || 'Transcription failed');
        setPhase('error');
      }
    };

    recorder.start();
    webRecorderRef.current = recorder;
    setPhase('recording');
    startTimer();
  };

  const startNativeRecording = async () => {
    const permission = await Audio.requestPermissionsAsync();

    if (!permission.granted) {
      throw new Error('Microphone permission denied.');
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    const recording = new Audio.Recording();

    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();

    nativeRecordingRef.current = recording;
    setPhase('recording');
    startTimer();
  };

  const start = async () => {
    setErrMsg(null);

    try {
      if (Platform.OS === 'web') {
        await startWebRecording();
      } else {
        await startNativeRecording();
      }
    } catch (e: any) {
      setErrMsg(e?.message || 'Could not start recording.');
      setPhase('error');
    }
  };

  const stop = async () => {
    stopTimer();

    if (Platform.OS === 'web') {
      if (webRecorderRef.current && webRecorderRef.current.state === 'recording') {
        webRecorderRef.current.stop();
      }
      return;
    }

    const recording = nativeRecordingRef.current;
    if (!recording) return;

    setPhase('transcribing');

    try {
      await recording.stopAndUnloadAsync();

      const uri = recording.getURI();
      nativeRecordingRef.current = null;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (!uri) {
        throw new Error('No recording file was created.');
      }

      const draft = await api.voiceTranscribe({
        uri,
        name: 'voice.m4a',
        type: 'audio/aac',
      });

      onDraft(draft);
    } catch (err: any) {
      console.log('native transcribe error', err);
      setErrMsg(err?.message || 'Transcription failed');
      setPhase('error');
    }
  };

  const fmt = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />

      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.badge}>
              <Sparkles color="#fff" size={12} />
              <Text style={styles.badgeText}>Voice → Smart Card</Text>
            </View>

            <PressScale testID="voice-close" onPress={onClose} style={styles.iconBtn}>
              <X color="#fff" size={18} />
            </PressScale>
          </View>

          <Text style={styles.heading}>{t('voice_capture')}</Text>
          <Text style={styles.sub}>{t('voice_hint')}</Text>

          <View style={styles.stage}>
            {phase === 'recording' ? (
              <>
                <View style={styles.pulseOuter}>
                  <View style={styles.pulseInner} />
                </View>
                <Text style={styles.timer}>{fmt(elapsed)}</Text>
                <Text style={styles.stageLabel}>{t('listening')}</Text>
              </>
            ) : null}

            {phase === 'transcribing' ? (
              <>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={[styles.stageLabel, { marginTop: 18 }]}>{t('transcribing')}</Text>
              </>
            ) : null}

            {phase === 'idle' ? (
              <View style={[styles.pulseOuter, { opacity: 0.35 }]}>
                <View style={styles.pulseInner} />
              </View>
            ) : null}

            {phase === 'error' ? <Text style={styles.errText}>{errMsg}</Text> : null}
          </View>

          <View style={styles.controls}>
            {phase === 'idle' ? (
              <PressScale testID="voice-record" onPress={start} style={styles.recordBtn}>
                <Mic color="#080910" size={18} />
                <Text style={styles.recordText}>{t('record')}</Text>
              </PressScale>
            ) : null}

            {phase === 'recording' ? (
              <PressScale testID="voice-stop" onPress={stop} style={styles.stopBtn}>
                <Square color="#fff" size={16} />
                <Text style={styles.stopText}>{t('stop')}</Text>
              </PressScale>
            ) : null}

            {phase === 'error' ? (
              <PressScale testID="voice-retry" onPress={start} style={styles.recordBtn}>
                <Mic color="#080910" size={18} />
                <Text style={styles.recordText}>{t('retry')}</Text>
              </PressScale>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.6)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: 'rgba(20,22,32,0.96)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 26,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
  },
  badgeText: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    letterSpacing: 0.4,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff',
    fontSize: 30,
    lineHeight: 36,
  },
  sub: {
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 22,
  },
  stage: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  pulseOuter: {
    width: 120,
    height: 120,
    borderRadius: 9999,
    backgroundColor: 'rgba(99,102,241,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseInner: {
    width: 68,
    height: 68,
    borderRadius: 9999,
    backgroundColor: 'rgba(99,102,241,0.6)',
  },
  timer: {
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
    fontSize: 22,
    marginTop: 14,
    letterSpacing: 1,
  },
  stageLabel: {
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 4,
  },
  errText: {
    fontFamily: 'Inter_400Regular',
    color: '#F97316',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  controls: { alignItems: 'center', marginTop: 10 },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  recordText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EF4444',
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  stopText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});
