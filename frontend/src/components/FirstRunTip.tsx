import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { logger } from '../logger';

type FirstRunTipProps = {
  /** Stable id — becomes the AsyncStorage key. Never reuse one across tips. */
  id: string;
  title: string;
  message: string;
  /** Icon rendered in the leading tile, e.g. <Star .../>. */
  icon: React.ReactNode;
  testID?: string;
};

const storageKey = (id: string) => `coo_tip_seen_${id}`;

/**
 * A one-time explainer shown inline at the top of a screen.
 *
 * Deliberately not a modal: these screens are already a lot to take in on a
 * first visit, and a dialog that must be dismissed before you can look at
 * anything makes that worse. The card sits in the flow, can be ignored, and
 * disappears for good once dismissed.
 *
 * Renders nothing until we know whether it has been seen, so a returning user
 * never sees it flash on screen before it is hidden again.
 */
export default function FirstRunTip({ id, title, message, icon, testID }: FirstRunTipProps) {
  const { theme, t } = useStore();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(storageKey(id))
      .then((seen) => {
        if (!cancelled && !seen) setVisible(true);
      })
      .catch((error) => {
        // Storage is unavailable — better to stay quiet than to show the tip
        // on every launch with no way to make it stick.
        logger.warn('FirstRunTip read failed:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const dismiss = useCallback(() => {
    setVisible(false);
    AsyncStorage.setItem(storageKey(id), '1').catch((error) => {
      logger.warn('FirstRunTip write failed:', error);
    });
  }, [id]);

  if (!visible) return null;

  return (
    <View
      testID={testID}
      style={[
        styles.wrap,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.cardBorder,
          shadowColor: theme.colors.shadow,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: theme.colors.accentSoft }]}>{icon}</View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
        <Text style={[styles.message, { color: theme.colors.textMuted }]}>{message}</Text>

        <PressScale
          testID={testID ? `${testID}-got-it` : undefined}
          accessibilityRole="button"
          onPress={dismiss}
          style={[styles.action, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
        >
          <Text style={[styles.actionText, { color: theme.colors.text }]}>{t('tip_got_it')}</Text>
        </PressScale>
      </View>

      <PressScale
        testID={testID ? `${testID}-dismiss` : undefined}
        accessibilityRole="button"
        accessibilityLabel={t('tip_dismiss')}
        onPress={dismiss}
        hitSlop={12}
        style={styles.close}
      >
        <X color={theme.colors.textMuted} size={16} />
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  title: { fontSize: 15, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  action: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionText: { fontSize: 14, fontWeight: '600' },
  // Sits beside the text rather than floating over it, so it can never cover a word.
  close: { alignSelf: 'flex-start', padding: 2 },
});
