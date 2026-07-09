import React, { Component, ErrorInfo, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

interface Props {
  tab: string;
  children: ReactNode;
}

interface InnerProps extends Props {
  ui: UIColors;
  t: (key: string, params?: Record<string, string | number>) => string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundaryInner extends Component<InnerProps, State> {
  constructor(props: InnerProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[ErrorBoundary] ${this.props.tab} crashed:`, error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { ui, t } = this.props;
      return (
        <View style={[styles.container, { backgroundColor: ui.bg }]}>
          <View style={[styles.card, { backgroundColor: ui.card, borderColor: ui.line }]}>
            <Text style={styles.emoji}>!</Text>
            <Text style={[styles.title, { color: ui.text }]}>{t('err_something_wrong')}</Text>
            <Text style={[styles.subtitle, { color: ui.muted }]}>
              {t('err_tab_crashed', { tab: this.props.tab })}
            </Text>
            {__DEV__ && this.state.error ? (
              <Text style={[styles.detail, { color: ui.muted }]} numberOfLines={4}>
                {this.state.error.message}
              </Text>
            ) : null}
            <PressScale onPress={this.handleReset} style={styles.button}>
              <Text style={styles.buttonText}>{t('err_try_again')}</Text>
            </PressScale>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundary(props: Props) {
  const ui = useUI();
  const { t } = useStore();
  return <ErrorBoundaryInner {...props} ui={ui} t={t} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: 1,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  emoji: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F56519',
    width: 56,
    height: 56,
    lineHeight: 56,
    textAlign: 'center',
    backgroundColor: '#FFF0E7',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  detail: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  button: {
    backgroundColor: '#F56519',
    borderRadius: 99,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
  },
});
