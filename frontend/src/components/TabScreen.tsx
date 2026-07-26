import React from 'react';
import { RefreshControl, ScrollView, ScrollViewProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
  // Clearance for the floating tab bar (height 78, bottom offset >= 14),
  // which grows with the gesture/nav inset once the app draws edge-to-edge.
  const tabBarClearance = Math.max(insets.bottom, 14) + 78 + 20;
  return (
    <ErrorBoundary tab={tab}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
        <OfflineBanner />
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...scrollViewProps}
          contentContainerStyle={[scrollViewProps?.contentContainerStyle, { paddingBottom: tabBarClearance }]}
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
