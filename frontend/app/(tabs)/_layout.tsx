import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  const iconColor = focused ? theme.colors.primaryText : theme.colors.textSoft;

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
      <Icon color={iconColor} size={focused ? 22 : 21} strokeWidth={focused ? 2.4 : 2.1} />
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
  const { t, theme, resolvedAppearance } = useStore();

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
          bottom: 16,
          height: 74,
          borderRadius: 28,
          backgroundColor: theme.colors.tabBar,
          borderTopWidth: 0,
          borderWidth: 1.25,
          borderColor: theme.colors.tabBorder,
          elevation: 0,
          shadowColor: theme.colors.shadow,
          shadowOpacity: 0.2,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          paddingHorizontal: 7,
          paddingTop: 8,
        },
        tabBarBackground: () =>
          Platform.OS === 'web' ? null : (
            <BlurView
              intensity={resolvedAppearance === 'light' ? 8 : 12}
              tint={resolvedAppearance}
              style={[StyleSheet.absoluteFill, { borderRadius: 28, overflow: 'hidden' }]}
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
    gap: 4,
    minWidth: 62,
    height: 58,
    borderRadius: 22,
    paddingTop: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
