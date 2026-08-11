import React, { useEffect, useState } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, Star, UtensilsCrossed, Plus } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { useBreakpoint } from '../../src/responsive';
import { InviteJoinPrompt } from '../../src/components/InviteJoinPrompt';
import { GlobalCapture } from '../../src/components/GlobalCapture';
import { MoreSheet } from '../../src/components/MoreSheet';

// ─── Phone: floating pill tab bar ────────────────────────────────────────────

/**
 * One tab. Every tab spells its name under the icon — a bar you have to tap
 * to learn is a bar doing half its job. The active one gets the accent pill
 * and ink; the rest sit quiet in muted text, so five small labels read as a
 * legend rather than noise. (Only five seats — four destinations and More —
 * so there is room for all of them.)
 */
function TabIcon({ focused, Icon, label }: { focused: boolean; Icon: any; label: string }) {
  const { theme } = useStore();
  // accentInk, not accent: the focused tab sits on an accentSoft pill, and the
  // brand orange on its own tint measures 2.7:1 — the label would be
  // decorative rather than readable.
  const iconColor = focused ? theme.colors.accentInk : theme.colors.textSoft;
  // The label is now always shown, so it must clear the 4.5:1 AA bar for
  // small text — textSoft (4.2:1) is fine for an icon but not for a word.
  // textMuted is the readable-ink twin; the icon stays quieter to keep the
  // active/inactive hierarchy.
  const labelColor = focused ? theme.colors.accentInk : theme.colors.textMuted;

  return (
    <View
      style={[
        styles.tabItem,
        focused && { backgroundColor: theme.mode === 'light' ? theme.colors.accentSoft : theme.colors.bgSoft },
      ]}
    >
      <Icon color={iconColor} size={22} strokeWidth={focused ? 2.5 : 2} />
      <Text
        style={[styles.tabLabel, { color: labelColor, fontFamily: focused ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}
        numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
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
        // The label is text and must clear AA (4.5:1); textSoft (4.2:1) only
        // clears the 3:1 icon bar. Give the label textMuted when inactive so a
        // persistent nav destination is legible, while the icon can stay soft.
        const labelColor = active ? iconColor : theme.colors.textMuted;

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
              <Text style={[styles.sidebarLabel, { color: labelColor }]}>
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

/**
 * The phone bar: four daily destinations and a centre ➕ for quick capture.
 * Rendering it ourselves (rather than styling the default bar) is what lets the
 * ➕ open a sheet instead of navigating — on web the built-in tab buttons are
 * anchors, which always navigate. The less-daily places (Vault, Settings,
 * Account, Hand-off) live in the Household menu, opened from the Feed header.
 */
function PhoneTabBar({ state, navigation, style, onAdd }: {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: any;
  style: object;
  onAdd: () => void;
}) {
  const { t, theme } = useStore();
  const c = theme.colors;
  const current = state.routes[state.index]?.name;

  const tab = (name: string, Icon: any, labelKey: string) => {
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
        onPress={() => { if (!focused) navigation.navigate(name); }}
      >
        <TabIcon focused={focused} Icon={Icon} label={t(labelKey)} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[style, styles.bar]}>
      {tab('feed', Home, 'feed')}
      {tab('calendar', CalendarIcon, 'calendar')}
      <View style={styles.barSlot}>
        <TouchableOpacity
          testID="tab-add"
          accessibilityRole="button"
          accessibilityLabel={t('qa_title')}
          activeOpacity={0.85}
          onPress={onAdd}
          style={[styles.addBtn, { backgroundColor: c.accent, shadowColor: c.accent }]}
        >
          <Plus color="#FFFFFF" size={28} strokeWidth={2.6} />
        </TouchableOpacity>
      </View>
      {tab('kids', Star, 'kids')}
      {tab('kitchen', UtensilsCrossed, 'kitchen')}
    </View>
  );
}

// ─── Root layout ─────────────────────────────────────────────────────────────

// Session-scoped guard so a new user is sent through onboarding at most once —
// prevents any redirect loop if completing onboarding ever fails to persist.
let onboardingRedirected = false;

export default function TabLayout() {
  const { t, theme, user, loading, householdMenuOpen, closeHouseholdMenu } = useStore();
  const { isWide, sidebarW } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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
              onAdd={() => setQuickAddOpen(true)}
            />
          )
        }
      >
        <Tabs.Screen name="feed" />
        <Tabs.Screen name="calendar" />
        <Tabs.Screen name="kids" />
        <Tabs.Screen name="kitchen" />
        {/* Routable, but not seats in the bar — reached from the Household menu
            in the Feed header. */}
        <Tabs.Screen name="vault"    options={{ href: null }} />
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="account"  options={{ href: null }} />
        {/* Reached from the feed header, never a tab. */}
        <Tabs.Screen name="search"   options={{ href: null }} />
      </Tabs>

      {isWide && <SidebarNav width={sidebarW} />}
      <GlobalCapture visible={quickAddOpen} onClose={() => setQuickAddOpen(false)} />
      <MoreSheet visible={householdMenuOpen} onClose={closeHouseholdMenu} />
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
  addBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
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
