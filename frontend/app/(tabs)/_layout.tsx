import React, { useEffect } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { useBreakpoint } from '../../src/responsive';

// ─── Phone: floating pill tab bar ────────────────────────────────────────────

function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  const light = theme.mode === 'light';

  if (light) {
    const color = focused ? theme.colors.accent : theme.colors.textSoft;
    return (
      <View style={styles.tabItem}>
        <Icon color={color} size={21} strokeWidth={focused ? 2.4 : 2} />
        <Text
          style={[styles.tabLabel, { color, fontFamily: focused ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    );
  }

  const activeColor = theme.colors.accent;
  const inactiveColor = theme.colors.textSoft;

  return (
    <View style={[styles.tabItem, focused && { backgroundColor: theme.colors.bgSoft }]}>
      <Icon color={focused ? activeColor : inactiveColor} size={21} strokeWidth={focused ? 2.5 : 2.1} />
      <Text
        style={[
          styles.tabLabel,
          { color: focused ? activeColor : inactiveColor, fontFamily: focused ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── Tablet / Desktop: left sidebar ──────────────────────────────────────────

const NAV_ITEMS = [
  { name: 'feed',     Icon: Home,          labelKey: 'feed' },
  { name: 'calendar', Icon: CalendarIcon,  labelKey: 'calendar' },
  { name: 'kids',     Icon: Star,          labelKey: 'kids' },
  { name: 'vault',    Icon: Lock,          labelKey: 'vault' },
  { name: 'settings', Icon: SettingsIcon,  labelKey: 'settings' },
] as const;

function SidebarNav({ width }: { width: number }) {
  const { theme, t } = useStore();
  const { isDesktop } = useBreakpoint();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const light = theme.mode === 'light';

  return (
    <View
      style={[
        styles.sidebar,
        {
          width,
          backgroundColor: theme.colors.tabBar,
          borderRightColor: theme.colors.tabBorder,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
        },
      ]}
    >
      {isDesktop && (
        <View style={styles.sidebarBrand}>
          <Text style={[styles.sidebarBrandText, { color: theme.colors.text }]}>COO</Text>
        </View>
      )}

      {NAV_ITEMS.map(({ name, Icon, labelKey }) => {
        const active = pathname === `/${name}` || pathname.endsWith(name);
        const iconColor = light
          ? active ? theme.colors.accent : theme.colors.textSoft
          : active ? theme.colors.primaryText : theme.colors.textSoft;

        return (
          <TouchableOpacity
            key={name}
            onPress={() => router.navigate(`/(tabs)/${name}` as any)}
            style={[
              styles.sidebarItem,
              isDesktop ? styles.sidebarItemWide : styles.sidebarItemCompact,
              active && (light ? { backgroundColor: theme.colors.accentSoft } : styles.sidebarItemActive),
            ]}
            activeOpacity={0.75}
            accessibilityRole="tab"
            accessibilityLabel={t(labelKey)}
            accessibilityState={{ selected: active }}
          >
            <Icon color={iconColor} size={20} strokeWidth={active ? 2.5 : 2.0} />
            {isDesktop && (
              <Text style={[styles.sidebarLabel, { color: iconColor }]}>
                {t(labelKey)}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Root layout ─────────────────────────────────────────────────────────────

// Session-scoped guard so a new user is sent through onboarding at most once —
// prevents any redirect loop if completing onboarding ever fails to persist.
let onboardingRedirected = false;

export default function TabLayout() {
  const { t, theme, user, loading } = useStore();
  const { isWide, sidebarW } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // If the session is cleared (logout or expiry), return to the landing screen.
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/');
    }
  }, [loading, user, router]);

  // First-run onboarding: only for a brand-new account (flag explicitly false),
  // and only once per app session. Missing/true flag never redirects, so
  // existing testers and old builds are unaffected.
  useEffect(() => {
    if (!loading && user && user.onboarding_completed === false && !onboardingRedirected) {
      onboardingRedirected = true;
      router.replace('/onboarding');
    }
  }, [loading, user, router]);

  const floatingTabStyle = {
    position: 'absolute' as const,
    left: 20,
    right: 20,
    bottom: Math.max(insets.bottom, 14),
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
  };

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          sceneStyle: isWide ? { marginLeft: sidebarW } : undefined,
          tabBarStyle: isWide ? { display: 'none' } : floatingTabStyle,
        }}
      >
        <Tabs.Screen name="feed"     options={{ tabBarAccessibilityLabel: t('feed'), tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Home}          label={t('feed')} /> }} />
        <Tabs.Screen name="calendar" options={{ tabBarAccessibilityLabel: t('calendar'), tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={CalendarIcon}  label={t('calendar')} /> }} />
        <Tabs.Screen name="kids"     options={{ tabBarAccessibilityLabel: t('kids'), tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Star}          label={t('kids')} /> }} />
        <Tabs.Screen name="vault"    options={{ tabBarAccessibilityLabel: t('vault'), tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={Lock}          label={t('vault')} /> }} />
        <Tabs.Screen name="settings" options={{ tabBarAccessibilityLabel: t('settings'), tabBarIcon: ({ focused }) => <TabIcon focused={focused} Icon={SettingsIcon}  label={t('settings')} /> }} />
        <Tabs.Screen name="account"  options={{ href: null }} />
      </Tabs>

      {isWide && <SidebarNav width={sidebarW} />}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Phone tab bar items
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

  // Sidebar
  sidebar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  sidebarBrand: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  sidebarBrandText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    letterSpacing: 2,
  },
  sidebarItem: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    marginVertical: 2,
  },
  sidebarItemCompact: {
    width: 52,
    height: 52,
  },
  sidebarItemWide: {
    flexDirection: 'row',
    width: '100%',
    height: 48,
    paddingHorizontal: 16,
    gap: 12,
    justifyContent: 'flex-start',
    borderRadius: 14,
  },
  sidebarItemActive: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  sidebarLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
});
