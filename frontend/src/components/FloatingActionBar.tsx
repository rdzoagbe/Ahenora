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
            backgroundColor: theme.colors.bgElevated,
            borderColor: theme.colors.cardBorder,
            shadowColor: theme.colors.shadow,
          },
        ]}
      >
        <View style={styles.row}>
          <PressScale testID="fab-voice" onPress={onVoice} style={styles.sideBtn}>
            <View style={[styles.sideIcon, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
              <Mic color={theme.colors.text} size={18} />
            </View>
            <Text style={[styles.sideLabel, { color: theme.colors.textMuted }]}>{t('voice')}</Text>
          </PressScale>

          <PressScale testID="fab-camera" onPress={onCamera} style={styles.centerBtn}>
            <View style={[styles.centerInner, { backgroundColor: theme.colors.primary }]}> 
              <Camera color={theme.colors.primaryText} size={24} />
            </View>
          </PressScale>

          <PressScale testID="fab-manual" onPress={onManual} style={styles.sideBtn}>
            <View style={[styles.sideIcon, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
              <Plus color={theme.colors.text} size={18} />
            </View>
            <Text style={[styles.sideLabel, { color: theme.colors.textMuted }]}>{t('manual')}</Text>
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
    paddingHorizontal: 18,
  },
  shell: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 26,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
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
  },
  sideLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.1,
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
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
