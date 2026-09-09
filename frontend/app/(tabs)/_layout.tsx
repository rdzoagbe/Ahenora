import React, { useEffect, useRef } from 'react';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Calendar as CalendarIcon, Lock, Settings as SettingsIcon, User as UserIcon, UtensilsCrossed, Users } from 'lucide-react-native';
import { useStore } from '../../src/store';
import { markStart, markEnd } from '../../src/perf';
import { useBreakpoint } from '../../src/responsive';
import { BAR_INSET, LABEL_FONT_SIZE, LABEL_MIN_SCALE, PILL_PADDING, SEAT_MIN_WIDTH, SEAT_PADDING } from '../../src/navGeometry';
import { GlobalCapture } from '../../src/components/GlobalCapture';

// ─── Phone: floating pill tab bar ────────────────────────────────────────────

/**
 * One tab. Every tab spells its name under the icon — a bar you have to tap
 * to learn is a bar doing half its job. The active one gets the accent pill
 * and ink; the rest sit quiet in muted text, so five small labels read as a
 * legend rather than noise.
 *
 * Five seats fit only because More gave up its button: the pill now spans
 * the whole 350pt between the bar's insets rather than the 278pt it had
 * beside a 62pt button and a gap. src/navGeometry.ts holds the arithmetic
 * and the reasons it is written down rather than eyeballed.
 */
function TabIcon({ focused, Icon, label, badge = 0 }: { focused: boolean; Icon: any; label: string; badge?: number }) {
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
      <View>
        <Icon color={iconColor} size={22} strokeWidth={focused ? 2.5 : 2} />
        {/* Messaging lives inside Family now, so this is the only thing that
            tells a parent a message arrived. */}
        {badge > 0 ? (
          <View style={[styles.tabBadge, { backgroundColor: theme.colors.accent, borderColor: theme.colors.tabBar }]}>
            <Text style={styles.tabBadgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[styles.tabLabel, { color: labelColor, fontFamily: focused ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}
        numberOfLines={1} adjustsFontSizeToFit minimumFontScale={LABEL_MIN_SCALE}
      >
        {label}
      </Text>
    </View>
  );
}

// ─── The five places ─────────────────────────────────────────────────────────

/**
 * The five places, in the order they sit in the bar and in the sidebar.
 *
 * Vault is a seat rather than a drawer row because the drawer was the reason
 * nobody found it: a document you need is needed *now*, and "somewhere behind
 * More" is not where a passport renewal reminder should live.
 *
 * It fits, measured rather than assumed — src/navGeometry.ts carries the
 * arithmetic, and the nav harness measures the real rendered boxes in a
 * browser on every run, because the paper version of this sum has been wrong
 * twice.
 *
 * A helper never sees the vault — the documents are the household's private
 * papers, and every /api/vault route is behind require_full_member, so a seat
 * we showed them would lead to a screen of 403s. Their bar has four seats.
 */
const NAV_ITEMS = [
  { name: 'feed',     Icon: Home,            labelKey: 'feed' },
  { name: 'calendar', Icon: CalendarIcon,    labelKey: 'calendar' },
  { name: 'kids',     Icon: Users,           labelKey: 'family_tab' },
  { name: 'kitchen',  Icon: UtensilsCrossed, labelKey: 'kitchen' },
  { name: 'vault',    Icon: Lock,            labelKey: 'vault', fullMemberOnly: true },
] as const;

export function navSeats(isHelper: boolean | undefined) {
  // 'fullMemberOnly' in it — the array is `as const`, so only the vault entry
  // carries the key and TypeScript narrows on the check rather than on a flag
  // every other entry would have to spell out as false.
  return NAV_ITEMS.filter((it) => !(isHelper && 'fullMemberOnly' in it && it.fullMemberOnly));
}

// ─── Tablet / Desktop: left sidebar ──────────────────────────────────────────

function SidebarNav({ width }: { width: number }) {
  const { theme, t, unreadChats, user } = useStore();
  const { isDesktop } = useBreakpoint();
  const router = useRouter();
  const pathname = usePathname();
  // Which tab we are waiting to see. A ref, not state: this must not cause a
  // render of the nav bar on every tap.
  const pendingTabRef = useRef<string | null>(null);
  useEffect(() => {
    const waiting = pendingTabRef.current;
    if (!waiting) return;
    if (pathname === `/${waiting}` || pathname.endsWith(waiting)) {
      pendingTabRef.current = null;
      markEnd(`tab:${waiting}`, 'tab_switch');
    }
  }, [pathname]);
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
          <Text style={[styles.sidebarBrandText, { color: theme.colors.text }]}>Ahenora</Text>
        </View>
      )}

      {navSeats(user?.is_helper).map(({ name, Icon, labelKey }) => {
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
            onPress={() => {
              // Started on the tap, ended when the destination's pathname
              // actually changes (see the effect below). Timing the navigate
              // call itself would report how long a function took to return,
              // which is always fast and always meaningless.
              markStart(`tab:${name}`);
              pendingTabRef.current = name;
              router.navigate(`/(tabs)/${name}` as any);
            }}
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
            <View>
              <Icon color={iconColor} size={20} strokeWidth={active ? 2.5 : 2.0} />
              {/* Same arrival signal the phone bar carries — a wide screen is
                  no less likely to miss a message. */}
              {name === 'kids' && unreadChats > 0 ? (
                <View style={[styles.tabBadge, { backgroundColor: theme.colors.accent, borderColor: theme.colors.tabBar }]}>
                  <Text style={styles.tabBadgeText}>{unreadChats > 9 ? '9+' : unreadChats}</Text>
                </View>
              ) : null}
            </View>
            {isDesktop && (
              <Text style={[styles.sidebarLabel, { color: labelColor }]}>
                {t(labelKey)}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}

      {/* The wide screen gets the same door the phone gets: the person who is
          signed in. Settings and the hand-over live behind it, so there is one
          place to look for "things about me" on either form factor rather than
          a grid icon on one and a portrait on the other. */}
      <TouchableOpacity
        testID="sidebar-account"
        onPress={() => router.navigate('/(tabs)/account' as any)}
        style={[styles.sidebarItem, isDesktop ? styles.sidebarItemWide : styles.sidebarItemCompact]}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={t('nav_more_account')}
      >
        <UserIcon color={theme.colors.textSoft} size={20} strokeWidth={2.0} />
        {isDesktop && (
          <Text style={[styles.sidebarLabel, { color: theme.colors.textMuted }]}>{t('nav_more_account')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Phone: the bar itself ───────────────────────────────────────────────────

/**
 * The phone bar: the five places, in one pill that spans the bar.
 *
 * More used to sit beside the pill as a second object, on the reasoning that a
 * drawer is not a destination and should not wear a seat. That was right about
 * More and wrong about what was inside it: the vault was a place, filed behind
 * a button whose label told you nothing about what it held. So More is gone
 * rather than promoted — the vault takes a seat, and the three things left in
 * the drawer (Settings, the hand-over, Your account) are all about *you*, so
 * they live behind the portrait in the Feed header, which already went to your
 * account and now goes to all three.
 *
 * Rendering the bar ourselves (rather than styling the default one) is still
 * what keeps the seats plain buttons: on web the built-in tab buttons are
 * anchors, and an anchor cannot be conditionally hidden per member type
 * without a full route swap.
 */
function PhoneTabBar({ state, navigation, style }: {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: any;
  style: object;
}) {
  const { t, theme, unreadChats, user } = useStore();
  const current = state.routes[state.index]?.name;
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.barWrap, { bottom: Math.max(insets.bottom, 14) }]} pointerEvents="box-none">
      <View style={[style, styles.bar]}>
        {navSeats(user?.is_helper).map(({ name, Icon, labelKey }) => {
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
              {/* Messaging lives inside Family, so that seat carries the only
                  thing that tells a parent a message arrived. */}
              <TabIcon
                focused={focused}
                Icon={Icon}
                label={t(labelKey)}
                badge={name === 'kids' ? unreadChats : 0}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Root layout ─────────────────────────────────────────────────────────────

// Per-user guard so each new account is sent through onboarding at most once —
// prevents a redirect loop if completing onboarding ever fails to persist, and
// (keyed on the id rather than a single boolean) still onboards a *second* new
// account that signs up in the same app session after the first signs out.
let onboardingRedirectedFor: string | null = null;

export default function TabLayout() {
  const { theme, user, loading, quickAddOpen, closeQuickAdd } = useStore();
  const { isWide, sidebarW } = useBreakpoint();
  const router = useRouter();

  // If the session is cleared (logout or expiry), return to the landing screen.
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/');
    }
    // A teen must never sit inside the full app — bounce to the teen view.
    if (!loading && user?.is_teen) {
      router.replace('/teen');
    }
  }, [loading, user, router]);

  // First-run onboarding: only for a brand-new account (flag explicitly false),
  // and only once per app session. Missing/true flag never redirects, so
  // existing testers and old builds are unaffected.
  useEffect(() => {
    if (!loading && user && user.onboarding_completed === false && onboardingRedirectedFor !== user.user_id) {
      onboardingRedirectedFor = user.user_id;
      router.replace('/onboarding');
    }
  }, [loading, user, router]);

  // The pill is the whole bar now — nothing sits beside it — which is where
  // the width for a fifth seat came from.
  const floatingTabStyle = {
    flex: 1,
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
    paddingHorizontal: PILL_PADDING,
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
            />
          )
        }
      >
        <Tabs.Screen name="feed" />
        <Tabs.Screen name="calendar" />
        <Tabs.Screen name="kids" />
        <Tabs.Screen name="kitchen" />
        {/* Messaging now lives inside the Family Hub — open a member to chat with
            them — so the standalone Messages inbox is no longer a bar seat.
            Kept routable (href:null) so any deep link still resolves. */}
        <Tabs.Screen name="chat" options={{ href: null }} />
        {/* A seat for everyone who is allowed one. A helper is not: every
            /api/vault route is behind require_full_member, so their bar would
            carry a door onto a screen of 403s. */}
        <Tabs.Screen name="vault" options={{ href: user?.is_helper ? null : undefined }} />
        {/* Routable, but not seats — reached from your portrait in the Feed
            header (phone) or the account row in the sidebar (wide). */}
        <Tabs.Screen name="settings" options={{ href: null }} />
        <Tabs.Screen name="account"  options={{ href: null }} />
        {/* Reached from the feed header, never a tab. */}
        <Tabs.Screen name="search"   options={{ href: null }} />
      </Tabs>

      {isWide && <SidebarNav width={sidebarW} />}
      <GlobalCapture visible={quickAddOpen} onClose={closeQuickAdd} />
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
  // box-none so the strip either side of the pill does not swallow taps meant
  // for the screen behind it.
  barWrap: {
    position: 'absolute',
    left: BAR_INSET,
    right: BAR_INSET,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Five seats share 338pt of pill on a 390pt phone — 67.6pt each — and only
  // 268pt on a 320pt one, 53.6pt each. maxWidth is the load-bearing line: the
  // seat sizes to its contents and nothing in the bar clips, so without it a
  // label (or a padding) too big for its share does not shrink or ellipsise,
  // it silently draws over the seat beside it. Measured, in the nav harness:
  // with the padding at 22pt the five accent pills overlapped by 12pt each
  // while every other check still reported the bar fine.
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: SEAT_MIN_WIDTH,
    maxWidth: '100%',
    paddingHorizontal: SEAT_PADDING,
    height: 54,
    borderRadius: 9999,
  },
  tabBadge: {
    position: 'absolute', top: -5, right: -9, minWidth: 17, height: 17, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5,
  },
  tabBadgeText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 10 },
  tabLabel: {
    fontSize: LABEL_FONT_SIZE,
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
