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
            backgroundColor: theme.colors.tabBar,
            borderColor: theme.colors.tabBorder,
            shadowColor: '#202323',
          },
        ]}
      >
        <View style={styles.row}>
          <PressScale testID="fab-voice" onPress={onVoice} style={styles.sideBtn}>
            <View style={styles.sideIcon}>
              <Mic color="#FFFFFF" size={18} />
            </View>
            <Text style={styles.sideLabel}>{t('voice')}</Text>
          </PressScale>

          <PressScale testID="fab-camera" onPress={onCamera} style={styles.centerBtn}>
            <View style={styles.centerInner}>
              <Camera color="#202323" size={24} />
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
    bottom: 100,
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  shell: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 32,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sideBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 8,
    borderRadius: 9999,
  },
  sideIcon: {
    width: 32,
    height: 32,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  sideLabel: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.78)',
  },
  centerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  centerInner: {
    width: 62,
    height: 62,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
