import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';

import { api, User, Subscription } from './api';
import { Lang, SUPPORTED_LANGS, translate } from './i18n';

export type { Lang } from './i18n';

const SESSION_TOKEN_KEY = 'household_coo_session_token';

interface StoreState {
  user: User | null;
  loading: boolean;
  lang: Lang;
  subscription: Subscription | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLang: (l: Lang) => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
  logout: () => Promise<void>;
  setUserFromAuth: (user: User, token: string) => Promise<void>;
  upgradePrompt: { feature: string; message: string } | null;
  showUpgradePrompt: (feature: string, message: string) => void;
  dismissUpgradePrompt: () => void;
}

const StoreContext = createContext<StoreState | null>(null);

async function saveStoredToken(token: string) {
  if (!token) {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    return;
  }

  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

async function clearStoredToken() {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>('en');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<{
    feature: string;
    message: string;
  } | null>(null);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(lang, key, params),
    [lang]
  );

  const refreshSubscription = useCallback(async () => {
    try {
      const s = await api.getSubscription();
      setSubscription(s);
    } catch (error) {
      console.log('refreshSubscription failed:', error);
      setSubscription(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);

      if (!token) {
        setUser(null);
        setSubscription(null);
        setLoading(false);
        return;
      }

     const u = (await api.me()) as User;

setUser(u);

if (SUPPORTED_LANGS.includes(u.language as Lang)) {
  setLangState(u.language as Lang);
}

      setUser(u);

      if (SUPPORTED_LANGS.includes(u.language as Lang)) {
        setLangState(u.language as Lang);
      }

      api.getSubscription()
        .then(setSubscription)
        .catch(() => setSubscription(null));
    } catch (error) {
      console.log('refreshUser failed:', error);

      setUser(null);
      setSubscription(null);

      await clearStoredToken();
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
        console.log('setLanguage failed:', error);
      }
    },
    [user]
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (error) {
      console.log('logout failed:', error);
    }

    await clearStoredToken();

    setUser(null);
    setSubscription(null);
    setLoading(false);
  }, []);

  const setUserFromAuth = useCallback(async (u: User, token: string) => {
    await saveStoredToken(token);

    setUser(u);

    if (SUPPORTED_LANGS.includes(u.language as Lang)) {
      setLangState(u.language as Lang);
    }

    setLoading(false);

    api.getSubscription()
      .then(setSubscription)
      .catch(() => setSubscription(null));
  }, []);

  const showUpgradePrompt = useCallback((feature: string, message: string) => {
    setUpgradePrompt({ feature, message });
  }, []);

  const dismissUpgradePrompt = useCallback(() => {
    setUpgradePrompt(null);
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <StoreContext.Provider
      value={{
        user,
        loading,
        lang,
        subscription,
        t,
        setLang,
        refreshUser,
        refreshSubscription,
        logout,
        setUserFromAuth,
        upgradePrompt,
        showUpgradePrompt,
        dismissUpgradePrompt,
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