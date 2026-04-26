import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  const iconColor = focused ? theme.colors.text : theme.colors.textSoft;

  return (
    <View style={[styles.tabItem, focused && { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
      <Icon color={iconColor} size={20} />
      <Text style={[styles.tabLabel, { color: iconColor, fontFamily: focused ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const { t, theme, resolvedAppearance } = useStore();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: theme.colors.bg },
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 20,
          height: 66,
          borderRadius: 26,
          backgroundColor: theme.colors.tabBar,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: theme.colors.tabBorder,
          elevation: 0,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.18,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
          paddingHorizontal: 8,
        },
        tabBarBackground: () =>
          Platform.OS === 'web' ? null : (
            <BlurView
              intensity={34}
              tint={resolvedAppearance}
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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.35,
  },
});
