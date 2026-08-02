import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useStore } from '../store';
import { OfflineState, onOfflineStateChange, refreshOfflineState } from '../api';

/**
 * "You're offline" on its own is an accusation, not information: it tells a
 * parent standing in a shop that the app has given up, when in fact the list
 * on screen is real and the item they just ticked off is safely remembered.
 *
 * So the bar reports what actually happened to the requests — the reads came
 * off the disk, N writes are waiting — rather than what the device guesses
 * about its own connection. The guess is wrong often enough to matter: a
 * captive hotel wifi, or a backend that is down while the phone has five bars,
 * both read as "connected" while nothing actually works.
 */
export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();
  const { t } = useStore();
  // Starts neutral on purpose: the exported web pages are pre-rendered, and a
  // first render that already knew about queued writes would not match the
  // HTML the browser was served. The real state arrives from the subscription.
  const [state, setState] = useState<OfflineState>({ fromCache: false, pending: 0 });

  useEffect(() => {
    const off = onOfflineStateChange(setState);
    refreshOfflineState();
    return off;
  }, []);

  const nothingToSay = isConnected && !state.fromCache && state.pending === 0;
  if (nothingToSay) return null;

  const message = state.fromCache
    ? t('offline_banner_cached')
    : !isConnected
      ? t('offline_banner')
      : t('offline_banner_syncing');

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{message}</Text>
      {state.pending > 0 ? (
        <Text style={styles.sub}>
          {state.pending === 1
            ? t('offline_pending_one')
            : t('offline_pending_many', { count: state.pending })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#101318',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  sub: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: 'Inter_500Medium',
    fontSize: 11.5,
    marginTop: 2,
    textAlign: 'center',
  },
});
