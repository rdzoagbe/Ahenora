import React from 'react';
import { RefreshControl, ScrollView, ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorBoundary } from './ErrorBoundary';
import { OfflineBanner } from './OfflineBanner';
import { useStore } from '../store';

interface TabScreenProps {
  tab: string;
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
  scrollViewProps?: Partial<ScrollViewProps>;
}

export function TabScreen({ tab, refreshing, onRefresh, children, scrollViewProps }: TabScreenProps) {
  const { theme } = useStore();
  return (
    <ErrorBoundary tab={tab}>
      <OfflineBanner />
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...scrollViewProps}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F56519"
            />
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </ErrorBoundary>
  );
}
