import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Text } from 'react-native';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  const activeBg = '#20252B';
  const iconColor = focused ? '#FFFFFF' : theme.colors.textMuted;

  return (
    <View style={[styles.tabItem, focused && { backgroundColor: activeBg }]}>
      <Icon color={iconColor} size={24} strokeWidth={focused ? 2.6 : 2.1} />
      <Text
        style={[
          styles.tabLabel,
          {
            color: iconColor,
            fontFamily: focused ? 'Inter_700Bold' : 'Inter_600SemiBold',
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const { t, theme } = useStore();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: theme.colors.bg },
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          height: 82,
          borderRadius: 34,
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: theme.colors.tabBorder,
          elevation: 14,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          paddingHorizontal: 8,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen name="feed" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Home} label={t('feed')} /> }} />
      <Tabs.Screen name="calendar" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={CalendarIcon} label={t('calendar')} /> }} />
      <Tabs.Screen name="kids" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Star} label={t('kids')} /> }} />
      <Tabs.Screen name="vault" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Lock} label={t('vault')} /> }} />
      <Tabs.Screen name="settings" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={SettingsIcon} label={t('settings')} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 64,
    height: 64,
    borderRadius: 26,
  },
  tabLabel: {
    fontSize: 12,
    letterSpacing: 0.1,
  },
});
