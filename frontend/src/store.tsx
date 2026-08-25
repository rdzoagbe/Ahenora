import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, useColorScheme } from 'react-native';
import { api, User, tokenStore, Subscription, resetOfflineState, setUnauthorizedHandler, warmupBackend, isTeenModeError } from './api';
import { clearSnapshots } from './offline';
import { Lang, SUPPORTED_LANGS, translate, detectDeviceLang } from './i18n';
import { AppearanceMode, AppTheme, getTheme, resolveAppearance, ResolvedAppearance } from './theme';
import { logger } from './logger';
import { saveLoginHint, clearLoginHint } from './loginHint';
import { deactivatePushOnLogout } from './notifications';

export type { Lang } from './i18n';
export type { AppearanceMode, ResolvedAppearance, AppTheme } from './theme';

interface StoreState {
  user: User | null;
  loading: boolean;
  lang: Lang;
  subscription: Subscription | null;
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  theme: AppTheme;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLang: (l: Lang) => Promise<void>;
  setAppearance: (mode: AppearanceMode) => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: (data: { password?: string; confirm?: boolean }) => Promise<void>;
  setUserFromAuth: (user: User, token: string, method?: 'google' | 'email') => Promise<void>;
  upgradePrompt: { feature: string; message: string } | null;
  showUpgradePrompt: (feature: string, message: string) => void;
  dismissUpgradePrompt: () => void;
  householdMenuOpen: boolean;
  openHouseholdMenu: () => void;
  closeHouseholdMenu: () => void;
  inviteRequested: boolean;
  requestInvite: () => void;
  clearInviteRequest: () => void;
  /** Raised by the Family screen's Members button so Settings opens straight
   *  onto the member list instead of its collapsed top level. */
  membersRequested: boolean;
  requestMembers: () => void;
  clearMembersRequest: () => void;
  // Bumped whenever something is captured from the global "+" so any visible
  // tab can refresh its data without a navigation.
  dataVersion: number;
  /** Unread family messages, so the Family tab can say so. Messaging lives
   *  inside the Hub now; without this a message arrives silently. */
  unreadChats: number;
  refreshUnreadChats: () => void;
  bumpData: () => void;
}

const StoreContext = createContext<StoreState | null>(null);

// v5 forces a fresh light/minimal default for existing local installs that cached premium-dark mode.
const APPEARANCE_STORAGE_KEY = 'coo_appearance_mode_minimal_light_v5';
// Set once an account has ever signed in on this device; survives sign-out so
// the auth screen can open on Log In for a returning user. See setUserFromAuth.
export const RETURNING_USER_KEY = 'coo_has_account';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // RN 0.86 widened ColorSchemeName to include 'unspecified'; the theme helpers
  // only understand light/dark/null, so normalize the new value to null (which
  // they already treat as "no preference").
  const rawScheme = useColorScheme();
  const systemScheme = rawScheme === 'light' || rawScheme === 'dark' ? rawScheme : null;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // First-open default follows the device / browser language; a signed-in
  // account's own saved language overrides it in refreshUser.
  const [lang, setLangState] = useState<Lang>(detectDeviceLang);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  // Follow the phone unless the parent has said otherwise. Defaulting to light
  // meant someone on a dark phone opening this at bedtime — which is when a
  // family app actually gets opened — got a white screen in the face, and had
  // to go find a setting to stop it. Anyone who has explicitly chosen light or
  // dark still keeps that choice: this is only the value before one is stored.
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>('system');
  const [upgradePrompt, setUpgradePrompt] = useState<{
    feature: string;
    message: string;
  } | null>(null);
  // The household menu (Settings, Vault, Account, Hand-off) is opened from every
  // screen's header, so its open state lives here rather than on the Feed alone.
  const [householdMenuOpen, setHouseholdMenuOpen] = useState(false);
  const openHouseholdMenu = useCallback(() => setHouseholdMenuOpen(true), []);
  const closeHouseholdMenu = useCallback(() => setHouseholdMenuOpen(false), []);
  // The Feed's "invite your co-parent" nudge lives on a different screen from the
  // invite sheet (Settings), so it raises this flag and navigates; Settings sees
  // it, opens the invite sheet, and clears it.
  const [inviteRequested, setInviteRequested] = useState(false);
  const requestInvite = useCallback(() => setInviteRequested(true), []);
  const clearInviteRequest = useCallback(() => setInviteRequested(false), []);
  const [membersRequested, setMembersRequested] = useState(false);
  const requestMembers = useCallback(() => setMembersRequested(true), []);
  const clearMembersRequest = useCallback(() => setMembersRequested(false), []);
  // A monotonic counter the global "+" bumps after a successful capture; tabs
  // depend on it to reload the surface the user is looking at.
  const [dataVersion, setDataVersion] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const resolvedAppearance = resolveAppearance(appearanceMode, systemScheme);
  const theme = useMemo(() => getTheme(appearanceMode, systemScheme), [appearanceMode, systemScheme]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(lang, key, params),
    [lang]
  );

  const refreshSubscription = useCallback(async () => {
    try {
      const token = await tokenStore.get();

      if (!token) {
        setSubscription(null);
        return;
      }

      const s = await api.getSubscription();
      setSubscription(s);
    } catch (error) {
      logger.warn('refreshSubscription failed:', error);
      setSubscription(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const token = await tokenStore.get();

      if (!token) {
        setUser(null);
        setSubscription(null);
        return;
      }

      let u: User;
      try {
        u = await api.me();
      } catch (e: any) {
        // A teen token is refused by /auth/me (require_user). Recognise that
        // and hydrate from the teen endpoint instead, flagged is_teen so the
        // app routes to the restricted teen view.
        if (isTeenModeError(e)) {
          const t = await api.teenMe();
          u = { ...t, is_teen: true, onboarding_completed: true } as User;
          setUser(u);
          if (SUPPORTED_LANGS.includes(u.language as Lang)) setLangState(u.language as Lang);
          return; // teens have no subscription surface to load
        }
        throw e;
      }
      setUser(u);

      if (SUPPORTED_LANGS.includes(u.language as Lang)) {
        setLangState(u.language as Lang);
      }

      api.getSubscription().then(setSubscription).catch((error) => {
        logger.warn('refresh subscription after user failed:', error);
        setSubscription(null);
      });
    } catch (error: any) {
      logger.warn('refreshUser failed:', error);
      // Only sign out on a real 401 (invalid/expired session). A transient
      // network failure or a cold backend must NOT wipe the token — otherwise
      // a returning user gets logged out by a momentary blip and has to sign
      // in again. Keeping the token lets the next launch/retry recover.
      if (error?.status === 401) {
        await tokenStore.clear();
        setUser(null);
        setSubscription(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const setLang = useCallback(
    async (l: Lang) => {
      setLangState(l);

      if (!user) return;

      try {
        await api.setLanguage(l);
      } catch (error) {
        logger.warn('setLanguage failed:', error);
      }
    },
    [user]
  );

  const setAppearance = useCallback(async (mode: AppearanceMode) => {
    setAppearanceMode(mode);
    try {
      await AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
    } catch (error) {
      logger.warn('setAppearance failed:', error);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = await tokenStore.get();

      if (token) {
        // While still authenticated: retire this device's push token and cancel
        // scheduled local notifications, so a shared/resold phone stops getting
        // the last household's pushes and digests.
        await deactivatePushOnLogout().catch(() => undefined);
        await api.logout();
      }
    } catch (error) {
      logger.warn('logout failed:', error);
    }

    await tokenStore.clear();
    // A shared or resold phone must not keep the last household's lists.
    await clearSnapshots().catch(() => undefined);
    resetOfflineState();
    setUser(null);
    setSubscription(null);
    setLoading(false);
  }, []);

  // Delete the account server-side, then tear the local session down exactly
  // as logout does — a deleted account must leave nothing behind on the device.
  const deleteAccount = useCallback(async (data: { password?: string; confirm?: boolean }) => {
    await api.deleteAccount(data);
    await tokenStore.clear();
    // A deleted account leaves nothing behind — including the welcome-back hint.
    await clearLoginHint().catch(() => undefined);
    await clearSnapshots().catch(() => undefined);
    resetOfflineState();
    setUser(null);
    setSubscription(null);
    setLoading(false);
  }, []);

  const refreshUnreadChats = useCallback(() => {
    api.chatThreads()
      .then((r) => setUnreadChats(r.threads.reduce((n, th) => n + (th.unread || 0), 0)))
      // Teens, helpers and signed-out users are refused this route by design;
      // a badge is a convenience and must never surface an error.
      // A teen, a helper or a signed-out user is refused this route by design —
      // zero is the right answer there. A dropped request is NOT: blanking the
      // badge on a flaky connection would quietly hide real messages, so the
      // last known count stands until a request actually succeeds.
      .catch((e: any) => { if (e?.status === 401 || e?.status === 403) setUnreadChats(0); });
  }, []);

  // On sign-in, and every time the app comes back to the foreground — the two
  // moments a parent would expect the count to be right.
  useEffect(() => {
    if (!user || user.is_teen) { setUnreadChats(0); return; }
    refreshUnreadChats();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshUnreadChats();
    });
    return () => sub.remove();
  }, [user, refreshUnreadChats]);

  const setUserFromAuth = useCallback(async (u: User, token: string, method?: 'google' | 'email') => {
    await tokenStore.set(token);

    const savedToken = await tokenStore.get();
    logger.info('Session token saved:', savedToken ? 'yes' : 'no');

    // Remember who signed in (email + method, never the token) so the next
    // visit greets them with "Welcome back" instead of a cold account screen.
    if (method && u.email) {
      saveLoginHint({ email: u.email, method }).catch(() => undefined);
    }

    // Remember that this device has an account, so the next visit after a
    // sign-out opens on Log In rather than Sign Up. Deliberately durable —
    // NOT cleared on sign-out or a 401 — because "have you ever had an account
    // here" is exactly the question the auth screen needs to answer.
    AsyncStorage.setItem(RETURNING_USER_KEY, '1').catch(() => undefined);

    setUser(u);

    if (SUPPORTED_LANGS.includes(u.language as Lang)) {
      setLangState(u.language as Lang);
    }

    setLoading(false);

    api.getSubscription().then(setSubscription).catch((error) => {
      logger.warn('subscription after auth failed:', error);
      setSubscription(null);
    });
  }, []);

  const showUpgradePrompt = useCallback((feature: string, message: string) => {
    setUpgradePrompt({ feature, message });
  }, []);

  const dismissUpgradePrompt = useCallback(() => {
    setUpgradePrompt(null);
  }, []);

  useEffect(() => {
    warmupBackend();
    refreshUser();
  }, [refreshUser]);

  // Clear auth state if any request reports the session expired (401). The
  // (tabs) layout redirects to the landing screen when user becomes null.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setSubscription(null);
      setLoading(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(APPEARANCE_STORAGE_KEY)
      .then((value) => {
        if (value === 'system' || value === 'dark' || value === 'light') {
          setAppearanceMode(value);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <StoreContext.Provider
      value={{
        user,
        loading,
        lang,
        subscription,
        appearanceMode,
        resolvedAppearance,
        theme,
        t,
        setLang,
        setAppearance,
        refreshUser,
        refreshSubscription,
        logout,
        deleteAccount,
        setUserFromAuth,
        upgradePrompt,
        showUpgradePrompt,
        dismissUpgradePrompt,
        householdMenuOpen,
        openHouseholdMenu,
        closeHouseholdMenu,
        inviteRequested,
        requestInvite,
        clearInviteRequest,
        membersRequested,
        requestMembers,
        clearMembersRequest,
        dataVersion,
        unreadChats,
        refreshUnreadChats,
        bumpData,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);

  if (!ctx) {
    throw new Error('useStore must be inside StoreProvider');
  }

  return ctx;
}
