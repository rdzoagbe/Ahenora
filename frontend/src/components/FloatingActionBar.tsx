import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Mic, Camera, Plus } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

interface Props {
  onManual: () => void;
  onCamera: () => void;
  onVoice: () => void;
}

export function FloatingActionBar({ onManual, onCamera, onVoice }: Props) {
  const { t, theme } = useStore();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View
        style={[
          styles.shell,
          {
            backgroundColor: '#20252B',
            borderColor: 'rgba(255,255,255,0.10)',
            shadowColor: theme.colors.shadow,
          },
        ]}
      >
        <PressScale testID="fab-voice" onPress={onVoice} style={styles.sideBtn}>
          <View style={styles.darkIcon}>
            <Mic color="#FFFFFF" size={18} />
          </View>
          <Text style={styles.sideLabel}>{t('voice')}</Text>
        </PressScale>

        <PressScale testID="fab-camera" onPress={onCamera} style={styles.centerBtn}>
          <Camera color="#20252B" size={25} />
        </PressScale>

        <PressScale testID="fab-manual" onPress={onManual} style={styles.sideBtn}>
          <View style={styles.darkIcon}>
            <Plus color="#FFFFFF" size={18} />
          </View>
          <Text style={styles.sideLabel}>{t('manual')}</Text>
        </PressScale>
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
    maxWidth: 430,
    minHeight: 76,
    borderRadius: 9999,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sideBtn: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9999,
    paddingHorizontal: 8,
  },
  sideLabel: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  darkIcon: {
    width: 34,
    height: 34,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtn: {
    width: 64,
    height: 64,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
