import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { UserPlus } from 'lucide-react-native';
import { useStore } from '../store';
import { api } from '../api';
import { extractInviteToken, clearStoredInvite } from '../invite';
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
  const checked = useRef(false);

  useEffect(() => {
    if (!user || checked.current) return;
    checked.current = true;
    let cancelled = false;

    const consider = async (candidate: string | null) => {
      if (!candidate || cancelled) return;
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
      consider(extractInviteToken(url));
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

  const accept = async () => {
    if (!token || busy) return;
    setBusy(true);
    try {
      await api.acceptInvite(token);
      clearStoredInvite();
      setJoined(true);
      await refreshUser();
      refreshSubscription();
      setTimeout(() => setToken(null), 1800);
    } catch (e: any) {
      logger.warn('invite accept failed', e?.message || e);
      setBusy(false);
      dismiss();
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
              <PressScale
                testID="invite-join-accept"
                onPress={accept}
                disabled={busy}
                style={[styles.primaryBtn, { backgroundColor: c.accent, opacity: busy ? 0.6 : 1 }]}
              >
                <Text style={[styles.primaryBtnText, { color: c.primaryText }]}>
                  {busy ? '…' : t('invite_join_cta')}
                </Text>
              </PressScale>
              <PressScale testID="invite-join-later" onPress={dismiss} disabled={busy} style={styles.ghostBtn}>
                <Text style={[styles.ghostBtnText, { color: c.textSoft }]}>{t('invite_join_later')}</Text>
              </PressScale>
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
});
