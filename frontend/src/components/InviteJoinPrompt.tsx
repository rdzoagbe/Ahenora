import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { UserPlus } from 'lucide-react-native';
import { useStore } from '../store';
import { api } from '../api';
import { extractInviteToken, clearStoredInvite } from '../invite';
import { BUILD_TAG } from '../buildInfo';
import { logger } from '../logger';
import { PressScale } from './PressScale';

/**
 * Signed-in invite acceptance. Invite links open the app directly for users
 * who already have a session, and those users never pass through the sign-in
 * screen where invite tokens are otherwise consumed — without this prompt the
 * link would silently do nothing for them.
 */
export function InviteJoinPrompt() {
  const { user, t, theme, refreshUser, refreshSubscription } = useStore();
  const c = theme.colors;
  const [token, setToken] = useState<string | null>(null);
  const [inviterName, setInviterName] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = useRef(false);

  useEffect(() => {
    if (!user || checked.current) return;
    checked.current = true;
    let cancelled = false;

    // Links are best-effort — they get buried in junk folders and lose their
    // token across browser contexts. Signing in is enough: when no link token
    // is at hand, ask the server whether an invite is waiting for this email.
    const askServer = async () => {
      try {
        const waiting = await api.invitesForMe();
        const first = waiting?.[0];
        if (first?.token && !cancelled) {
          setInviterName(first.inviter_name);
          setToken(first.token);
        }
      } catch (e: any) {
        logger.warn('invites-for-me lookup failed', e?.message || e);
      }
    };

    const consider = async (candidate: string | null) => {
      if (cancelled) return;
      if (!candidate) {
        await askServer();
        return;
      }
      try {
        const info = await api.getInvite(candidate);
        if (info.status === 'accepted') {
          clearStoredInvite();
          return;
        }
        if (!cancelled) {
          setInviterName(info.inviter_name);
          setToken(candidate);
        }
      } catch (e: any) {
        logger.warn('pending invite lookup failed', e?.message || e);
        clearStoredInvite();
        await askServer();
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      let stored: string | null = null;
      try {
        stored = window.sessionStorage.getItem('pending_invite');
      } catch {
        // Ignore storage failure.
      }
      consider(stored || extractInviteToken(window.location.href));
      return;
    }

    Linking.getInitialURL().then((url) => consider(extractInviteToken(url)));
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const fromLink = extractInviteToken(url);
      if (fromLink) consider(fromLink);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [user]);

  const dismiss = () => {
    clearStoredInvite();
    setToken(null);
  };

  const succeed = async () => {
    clearStoredInvite();
    setJoined(true);
    await refreshUser().catch(() => undefined);
    refreshSubscription();
    setTimeout(() => setToken(null), 1800);
  };

  // A 200 alone is not a join: if a fallback lands on a server that ignores
  // its redeem marker, the discovery URL answers with the plain invite list.
  // Only an explicit join response counts.
  const confirmJoined = (res: { ok?: boolean; user?: unknown } | unknown) => {
    if (!res || (res as { ok?: boolean }).ok !== true) {
      throw new Error('unexpected response shape from join');
    }
  };

  const accept = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      confirmJoined(await api.acceptInvite(token));
      await succeed();
    } catch (e: any) {
      let raw = String(e?.message || '');
      logger.warn('invite accept failed', raw || e);
      // An invite this user already accepted is a success, not a failure —
      // the family switch happened on the first tap.
      if (raw.startsWith('409')) {
        await succeed();
        return;
      }
      // A network-layer death (no HTTP status at all) means something on the
      // device or network ate the request. Walk the fallbacks: the bland GET,
      // then the discovery URL itself — which provably works, because it is
      // the very request that put this card on screen.
      if (!/^\d{3}:/.test(raw)) {
        for (const attempt of [api.acceptInviteViaGet, api.acceptInviteViaDiscovery]) {
          try {
            confirmJoined(await attempt(token));
            await succeed();
            return;
          } catch (e2: any) {
            raw = String(e2?.message || raw);
            logger.warn('invite accept fallback failed', raw);
            if (raw.startsWith('409')) {
              await succeed();
              return;
            }
            // A real HTTP answer (4xx/5xx) is a verdict, not a blocked
            // pipe — stop walking and show it.
            if (/^\d{3}:/.test(raw)) break;
          }
        }
      }
      // Anything else stays on screen with a retry: a silent close reads
      // as "nothing happened" and hides the actual problem.
      setBusy(false);
      const detail = raw.match(/\{.*"detail"\s*:\s*"([^"]+)"/)?.[1];
      // No detail means the request never got a readable answer — keep the
      // raw reason visible ("Load failed", "aborted"...) so a user screenshot
      // pinpoints network vs timeout vs server without a debug session.
      const reason = raw.replace(/[{}"\\]/g, '').trim().slice(0, 90);
      setError(detail || `${t('invite_join_error')}${reason ? ` (${reason})` : ''}`);
    }
  };

  if (!token) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.cardBorder, shadowColor: c.shadow }]}>
          <View style={[styles.iconBubble, { backgroundColor: c.accentSoft }]}>
            <UserPlus color={c.accent} size={22} />
          </View>
          {joined ? (
            <Text style={[styles.title, { color: c.text }]}>{t('invite_joined_ok')}</Text>
          ) : (
            <>
              <Text style={[styles.title, { color: c.text }]}>{t('invite_join_title')}</Text>
              <Text style={[styles.question, { color: c.text }]}>
                {t('invite_join_q').replace('{name}', inviterName)}
              </Text>
              <Text style={[styles.note, { color: c.textSoft }]}>{t('invite_join_note')}</Text>
              {error ? (
                <Text style={[styles.note, { color: '#EF4444', marginTop: 10 }]}>{error}</Text>
              ) : null}
              <PressScale
                testID="invite-join-accept"
                onPress={accept}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('invite_join_cta')}
                style={[styles.primaryBtn, { backgroundColor: c.accent, opacity: busy ? 0.7 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={c.primaryText} size="small" />
                ) : (
                  <Text style={[styles.primaryBtnText, { color: c.primaryText }]}>
                    {error ? t('invite_join_retry') : t('invite_join_cta')}
                  </Text>
                )}
              </PressScale>
              <PressScale
                testID="invite-join-later"
                onPress={dismiss}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={t('invite_join_later')}
                style={styles.ghostBtn}
              >
                <Text style={[styles.ghostBtnText, { color: c.textSoft }]}>{t('invite_join_later')}</Text>
              </PressScale>
              <Text style={[styles.buildTag, { color: c.textSoft }]}>{BUILD_TAG}</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,9,16,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 17,
    textAlign: 'center',
  },
  question: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 10,
  },
  note: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
  },
  primaryBtn: {
    marginTop: 18,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
  },
  ghostBtn: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  ghostBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  buildTag: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    opacity: 0.55,
    marginTop: 10,
  },
});
