import React, { useEffect, useState } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star, UtensilsCrossed, MoreHorizontal } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { useBreakpoint } from '../../src/responsive';
import { InviteJoinPrompt } from '../../src/components/InviteJoinPrompt';
import { MoreSheet } from '../../src/components/MoreSheet';

// ─── Phone: floating pill tab bar ────────────────────────────────────────────

/**
 * One tab. Only the ACTIVE tab spells its name: six shrunken 10px words was
 * the noisiest thing on the screen, and a bar that says where you are reads
 * faster than one that lists where you could go. Inactive tabs get the room
 * back as icon size and touch area.
 */
function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  // accentInk, not accent: the focused tab sits on an accentSoft pill, and the
  // brand orange on its own tint measures 2.7:1 — the label was decorative
  // rather than readable.
  const color = focused ? theme.colors.accentInk : theme.colors.textSoft;

  return (
    <View
      style={[
        styles.tabItem,
        focused && { backgroundColor: theme.mode === 'light' ? theme.colors.accentSoft : theme.colors.bgSoft },
      ]}
    >
      <Icon color={color} size={focused ? 22 : 24} strokeWidth={focused ? 2.5 : 2} />
      {focused ? (
        <Text
          style={[styles.tabLabel, { color }]}
          numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Tablet / Desktop: left sidebar ──────────────────────────────────────────

const NAV_ITEMS = [
  { name: 'feed',     Icon: Home,          labelKey: 'feed' },
  { name: 'calendar', Icon: CalendarIcon,  labelKey: 'calendar' },
  { name: 'kids',     Icon: Star,          labelKey: 'kids' },
  { name: 'kitchen',  Icon: UtensilsCrossed, labelKey: 'kitchen' },
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
          ? active ? theme.colors.accentInk : theme.colors.textSoft
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

// ─── Phone: the bar itself ───────────────────────────────────────────────────

const PHONE_TABS = [
  { name: 'feed', Icon: Home, labelKey: 'feed' },
  { name: 'calendar', Icon: CalendarIcon, labelKey: 'calendar' },
  { name: 'kids', Icon: Star, labelKey: 'kids' },
  { name: 'kitchen', Icon: UtensilsCrossed, labelKey: 'kitchen' },
] as const;

/**
 * Four destinations and a More button. Rendering the bar ourselves rather
 * than styling the default one is what lets the fifth slot open a sheet
 * instead of navigating: on web the built-in tab buttons are anchors, and an
 * anchor navigates whatever the press handler says.
 */
function PhoneTabBar({ state, navigation, style, onMore, moreActive }: {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: any;
  style: object;
  onMore: () => void;
  moreActive: boolean;
}) {
  const { t } = useStore();
  const current = state.routes[state.index]?.name;
  // Vault, Settings and Account have no seat here, so the More button owns
  // the active state while you are on one of them.
  const onHiddenRoute = !PHONE_TABS.some((tab) => tab.name === current);

  return (
    <View style={[style, styles.bar]}>
      {PHONE_TABS.map(({ name, Icon, labelKey }) => {
        const focused = current === name;
        return (
          <TouchableOpacity
            key={name}
            testID={`tab-${name}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(labelKey)}
            activeOpacity={0.75}
            style={styles.barSlot}
            onPress={() => {
              if (!focused) navigation.navigate(name);
            }}
          >
            <TabIcon focused={focused} Icon={Icon} label={t(labelKey)} />
          </TouchableOpacity>
        );
      })}
      <TouchableOpacity
        testID="tab-more"
        accessibilityRole="button"
        accessibilityLabel={t('nav_more')}
        activeOpacity={0.75}
        style={styles.barSlot}
        onPress={onMore}
      >
        <TabIcon focused={moreActive || onHiddenRoute} Icon={MoreHorizontal} label={t('nav_more')} />
      </TouchableOpacity>
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
  const [moreOpen, setMoreOpen] = useState(false);

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
    height: 74,
    borderRadius: 30,
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
  };

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: isWide ? { marginLeft: sidebarW } : undefined,
        }}
        tabBar={(props) =>
          isWide ? null : (
            <PhoneTabBar
              state={props.state}
              navigation={props.navigation}
              style={floatingTabStyle}
              onMore={() => setMoreOpen(true)}
              moreActive={moreOpen}
            />
          )
        }
      >
        <Tabs.Screen name="feed" />
        <Tabs.Screen name="calendar" />
        <Tabs.Screen name="kids" />
        <Tabs.Screen name="kitchen" />
        {/* Routable, but not seats in the bar — they live in the More sheet. */}
        <Tabs.Screen name="vault"    options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="account"  options={{ href: null }} />
        {/* Reached from the feed header and the More sheet, never a tab. */}
        <Tabs.Screen name="search"   options={{ href: null }} />
      </Tabs>

      {isWide && <SidebarNav width={sidebarW} />}
      <MoreSheet visible={moreOpen} onClose={() => setMoreOpen(false)} />
      <InviteJoinPrompt />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Phone tab bar items
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 62,
    paddingHorizontal: 12,
    height: 54,
    borderRadius: 9999,
  },
  tabLabel: {
    fontSize: 11,
    fontFamily: 'Inter_800ExtraBold',
    letterSpacing: -0.1,
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
