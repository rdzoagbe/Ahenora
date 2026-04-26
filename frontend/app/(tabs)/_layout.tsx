import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  return (
    <View style={[styles.tabItem, focused && styles.tabItemActive]}>
      <Icon color={focused ? '#FFFFFF' : 'rgba(255,255,255,0.42)'} size={focused ? 21 : 20} />
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const { t } = useStore();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 20,
          height: 66,
          borderRadius: 26,
          backgroundColor: 'rgba(14,15,22,0.82)',
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.10)',
          elevation: 0,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 14 },
          paddingHorizontal: 8,
        },
        tabBarBackground: () =>
          Platform.OS === 'web' ? null : (
            <BlurView
              intensity={34}
              tint="dark"
              style={[StyleSheet.absoluteFill, { borderRadius: 26, overflow: 'hidden' }]}
            />
          ),
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Home} label={t('feed')} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={CalendarIcon} label={t('calendar')} />,
        }}
      />
      <Tabs.Screen
        name="kids"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Star} label={t('kids')} />,
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Lock} label={t('vault')} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={SettingsIcon} label={t('settings')} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 58,
    height: 52,
    borderRadius: 20,
    paddingTop: 6,
  },
  tabItemActive: {
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tabLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    letterSpacing: 0.35,
    color: 'rgba(255,255,255,0.42)',
  },
  tabLabelActive: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
  },
});
