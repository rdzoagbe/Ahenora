import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Mic, Camera, Plus } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

interface Props {
  onManual: () => void;
  onCamera: () => void;
  onVoice: () => void;
}

export function FloatingActionBar({ onManual, onCamera, onVoice }: Props) {
  const { t } = useStore();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.shell}>
        <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.tint} pointerEvents="none" />

        <View style={styles.row}>
          <PressScale testID="fab-voice" onPress={onVoice} style={styles.sideBtn}>
            <View style={styles.sideIcon}>
              <Mic color="#FFFFFF" size={18} />
            </View>
            <Text style={styles.sideLabel}>{t('voice')}</Text>
          </PressScale>

          <PressScale testID="fab-camera" onPress={onCamera} style={styles.centerBtn}>
            <View style={styles.centerInner}>
              <Camera color="#080910" size={23} />
            </View>
          </PressScale>

          <PressScale testID="fab-manual" onPress={onManual} style={styles.sideBtn}>
            <View style={styles.sideIcon}>
              <Plus color="#FFFFFF" size={18} />
            </View>
            <Text style={styles.sideLabel}>{t('manual')}</Text>
          </PressScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  shell: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(14,15,22,0.72)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 12,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(14,15,22,0.64)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sideBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 9999,
  },
  sideIcon: {
    width: 26,
    height: 26,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  sideLabel: {
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.74)',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  centerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  centerInner: {
    width: 58,
    height: 58,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
});
