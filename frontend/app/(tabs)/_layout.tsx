import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Text } from 'react-native';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  const iconColor = focused ? theme.colors.primaryText : theme.colors.textMuted;

  return (
    <View
      style={[
        styles.tabItem,
        focused && {
          backgroundColor: theme.colors.primary,
          borderColor: theme.colors.primary,
        },
      ]}
    >
      <Icon color={iconColor} size={22} strokeWidth={focused ? 2.5 : 2.1} />
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
          left: 14,
          right: 14,
          bottom: 14,
          height: 76,
          borderRadius: 30,
          backgroundColor: theme.colors.tabBar,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: theme.colors.tabBorder,
          elevation: 8,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.14,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
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
    minWidth: 62,
    height: 58,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabLabel: {
    fontSize: 12,
    letterSpacing: 0.1,
  },
});
