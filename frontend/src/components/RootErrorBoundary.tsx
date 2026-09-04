import React, { Component, ErrorInfo, ReactNode } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { detectDeviceLang, translate } from '../i18n';
import { logger } from '../logger';

/**
 * The last thing between a render error and a phone that will not open the app.
 *
 * There WAS a boundary — inside TabScreen, wrapping the scrollable content of a
 * tab. Everything else was bare: every modal (they are siblings of TabScreen,
 * not children), the tab layout, the store provider, the router. A throw in any
 * of those took the whole app down with no way back.
 *
 * That is not hypothetical. Shipping a voice recorder over the air put a
 * `require` of a native module into the Feed's first render, on binaries built
 * before that module existed. One button's worth of broken code, and the app
 * would not start — for everyone, until an update was published and fetched.
 * A boundary here would have made it a panel on one screen.
 *
 * Deliberately dependency-free. It uses no store, no theme, no context: the
 * thing it most needs to survive is the thing that failed, and a fallback that
 * calls useStore() cannot render when the store is what threw. Language comes
 * from the device rather than from settings, for the same reason.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Not from the theme — the theme lives in the store. Chosen to be legible on
// either scheme rather than to match one.
const INK_LIGHT = '#1A1614';
const INK_DARK = '#F6F0E8';
const BG_LIGHT = '#FBF7F2';
const BG_DARK = '#16130F';
const ACCENT = '#D2540E';

class RootErrorBoundaryInner extends Component<Props & { dark: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // logger is a plain module, not a hook, so it is safe here.
    logger.warn('app-level crash', error?.message, info?.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const lang = detectDeviceLang();
    const t = (key: string) => translate(lang, key);
    const dark = this.props.dark;
    const ink = dark ? INK_DARK : INK_LIGHT;
    const bg = dark ? BG_DARK : BG_LIGHT;

    return (
      <View style={[styles.fill, { backgroundColor: bg }]} testID="root-error">
        <View style={styles.card}>
          <Text style={[styles.title, { color: ink }]}>{t('err_something_wrong')}</Text>
          <Text style={[styles.body, { color: ink }]}>{t('err_app_crashed')}</Text>
          {/* The message, only in development. In a shipped app it is noise to
              the reader and a hint to anybody else. */}
          {__DEV__ ? (
            <Text style={[styles.detail, { color: ink }]} numberOfLines={6}>{error.message}</Text>
          ) : null}
          <Text
            accessibilityRole="button"
            testID="root-error-retry"
            onPress={this.reset}
            style={[styles.button, { color: ACCENT }]}
          >
            {t('err_try_again')}
          </Text>
        </View>
      </View>
    );
  }
}

/** A function wrapper only so the colour scheme can be read as a hook. */
export function RootErrorBoundary({ children }: Props) {
  const scheme = useColorScheme();
  return (
    <RootErrorBoundaryInner dark={scheme === 'dark'}>{children}</RootErrorBoundaryInner>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { maxWidth: 340, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center', opacity: 0.8 },
  detail: { fontSize: 12, marginTop: 14, opacity: 0.6, textAlign: 'center' },
  button: { fontSize: 16, fontWeight: '700', marginTop: 22, padding: 10 },
});
