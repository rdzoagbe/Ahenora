import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Text } from 'react-native';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  const light = theme.mode === 'light';
  const activeBg = light ? '#FFFFFF' : '#FFFFFF';
  const activeColor = '#202323';
  const inactiveColor = light ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.64)';

  return (
    <View style={[styles.tabItem, focused && { backgroundColor: activeBg }]}>
      <Icon color={focused ? activeColor : inactiveColor} size={21} strokeWidth={focused ? 2.5 : 2.1} />
      <Text
        style={[
          styles.tabLabel,
          {
            color: focused ? activeColor : inactiveColor,
            fontFamily: focused ? 'Inter_800ExtraBold' : 'Inter_600SemiBold',
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
          left: 20,
          right: 20,
          bottom: 14,
          height: 78,
          borderRadius: 32,
          backgroundColor: theme.colors.tabBar,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: theme.colors.tabBorder,
          elevation: 10,
          shadowColor: '#202323',
          shadowOpacity: theme.mode === 'light' ? 0.16 : 0.28,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 12 },
          paddingHorizontal: 6,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen name="feed" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Home} label={t('feed')} /> }} />
      <Tabs.Screen name="calendar" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={CalendarIcon} label={t('calendar')} /> }} />
      <Tabs.Screen name="kids" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Star} label={t('kids')} /> }} />
      <Tabs.Screen name="vault" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Lock} label={t('vault')} /> }} />
      <Tabs.Screen name="settings" options={{ tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={SettingsIcon} label={t('settings')} /> }} />
      <Tabs.Screen name="account" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 58,
    height: 60,
    borderRadius: 9999,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.1,
  },
});
