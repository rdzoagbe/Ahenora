import React, { Component, ErrorInfo, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from './PressScale';

interface Props {
  tab: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
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
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.emoji}>!</Text>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle}>
              The {this.props.tab} tab ran into an unexpected error.
            </Text>
            {__DEV__ && this.state.error ? (
              <Text style={styles.detail} numberOfLines={4}>
                {this.state.error.message}
              </Text>
            ) : null}
            <PressScale onPress={this.handleReset} style={styles.button}>
              <Text style={styles.buttonText}>Try again</Text>
            </PressScale>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E6E1DA',
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
    color: '#101318',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    color: '#8A909A',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  detail: {
    color: '#8A909A',
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
