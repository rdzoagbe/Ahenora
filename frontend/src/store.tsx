import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { api, User, tokenStore, Subscription } from './api';
import { Lang, SUPPORTED_LANGS, translate } from './i18n';

export type { Lang } from './i18n';

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
      const token = await tokenStore.get();

      if (!token) {
        setSubscription(null);
        return;
      }

      const s = await api.getSubscription();
      setSubscription(s);
    } catch (error) {
      console.log('refreshSubscription failed:', error);
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

      const u = await api.me();

      setUser(u);

      if (SUPPORTED_LANGS.includes(u.language as Lang)) {
        setLangState(u.language as Lang);
      }

      api.getSubscription().then(setSubscription).catch((error) => {
        console.log('refresh subscription after user failed:', error);
        setSubscription(null);
      });
    } catch (error) {
      console.log('refreshUser failed:', error);

      await tokenStore.clear();

      setUser(null);
      setSubscription(null);
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
      const token = await tokenStore.get();

      if (token) {
        await api.logout();
      }
    } catch (error) {
      console.log('logout failed:', error);
    }

    await tokenStore.clear();

    setUser(null);
    setSubscription(null);
    setLoading(false);
  }, []);

  const setUserFromAuth = useCallback(async (u: User, token: string) => {
    await tokenStore.set(token);

    const savedToken = await tokenStore.get();
    console.log('Session token saved:', savedToken ? 'yes' : 'no');

    setUser(u);

    if (SUPPORTED_LANGS.includes(u.language as Lang)) {
      setLangState(u.language as Lang);
    }

    setLoading(false);

    api.getSubscription().then(setSubscription).catch((error) => {
      console.log('subscription after auth failed:', error);
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
