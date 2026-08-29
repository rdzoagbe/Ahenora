import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Users, X, ArrowRight } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { shareHouseholdInvite } from '../inviteShare';
import { useUI, UIColors } from './Kit';

const DISMISS_KEY = 'coo_coparent_nudge_dismissed';
// A separate flag, because the two prompts mean different things and so does
// dismissing them. "Stop asking me to invite a co-parent" is a statement about
// the household; "stop telling me this person is stuck outside it" is about one
// invitation the reader already chose to send.
const RECOVER_DISMISS_KEY = 'coo_coparent_recover_dismissed';

interface Props {
  /** True while the household is still solo (only the current user). */
  visible: boolean;
  /** The slower route: the Settings screen, where an invitation can be typed
   *  to a specific address. Kept as a quiet second option, not the headline. */
  onInvite: () => void;
  /**
   * Someone this household already invited who never made it in. When present
   * the nudge speaks about THEM instead of asking for a name: they signed up
   * and landed in a household of their own, or the invitation aged out. Only
   * the household that invited them can invite them again, so this prompt has
   * to reach the inviter — a founder cannot reach into somebody else's family.
   */
  stranded?: { email: string; reason: string } | null;
  /** Sends that invitation again. Resolves false if it did not go. */
  onResend?: (email: string) => Promise<boolean>;
}

/**
 * The growth+retention lever for a family app: a joined co-parent turns a solo
 * user (who churns) into a shared household (which sticks). Shown on the Feed
 * only while the household is solo, and it vanishes the moment someone joins.
 * Dismissible for genuine single parents, who can still invite from Settings.
 */
export function CoParentNudge({ visible, onInvite, stranded, onResend }: Props) {
  const { t, user } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  // null = still reading the flag (avoid a flash); false = show; true = hidden.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [recoverDismissed, setRecoverDismissed] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // Set when the browser has no share sheet and the link went to the clipboard,
  // or when sharing failed and the link is being handed back rather than lost.
  const [linkNote, setLinkNote] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY).then((v) => setDismissed(v === '1')).catch(() => setDismissed(false));
    AsyncStorage.getItem(RECOVER_DISMISS_KEY)
      .then((v) => setRecoverDismissed(v === '1'))
      .catch(() => setRecoverDismissed(false));
  }, []);

  // The stranded case outranks the generic ask: "Sarah signed up but never
  // joined — send it again" is strictly more useful than "invite a co-parent",
  // and both would otherwise want the same slot on a solo household's Feed.
  const recover = stranded && onResend ? stranded : null;
  if (!visible) return null;
  // Dismissing "invite a co-parent" means "I am a single parent, stop asking".
  // It cannot also mean "never tell me that the person I DID invite is stuck
  // outside my household" — that is news about something the reader already
  // chose to do, and silencing it hid the prompt from exactly the people it
  // exists for, since anyone who invited someone had usually dismissed the
  // generic ask long before. The recovery prompt is not silenced by that flag;
  // it disappears on its own when there is nobody left stranded.
  if (recover ? recoverDismissed !== false : dismissed !== false) return null;

  const resend = async () => {
    if (!recover || sending) return;
    setSending(true);
    try {
      if (await onResend!(recover.email)) setSent(true);
    } finally {
      setSending(false);
    }
  };

  // The whole point of this component. One tap: mint a link, open the share
  // sheet, let them send it however they already talk to the person. No
  // navigation, and nothing to type — the email field in Settings is what the
  // 87% who never invited anybody were being asked for.
  const shareInvite = async () => {
    if (sending) return;
    setSending(true);
    setLinkNote(null);
    try {
      const out = await shareHouseholdInvite({
        inviterName: user?.name || '',
        title: t('cp_share_title'),
        invitedYou: t('cp_share_invited_you'),
      });
      if (out.kind === 'shared') setSent(true);
      else if (out.kind === 'copied') { setSent(true); setLinkNote(t('cp_share_copied')); }
      else if (out.kind === 'failed' && out.url) setLinkNote(out.url);
      else setLinkNote(t('cp_share_unavailable'));
    } finally {
      setSending(false);
    }
  };

  const dismiss = () => {
    if (recover) {
      setRecoverDismissed(true);
      AsyncStorage.setItem(RECOVER_DISMISS_KEY, '1').catch(() => {});
      return;
    }
    setDismissed(true);
    AsyncStorage.setItem(DISMISS_KEY, '1').catch(() => {});
  };

  return (
    <View style={styles.card}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        testID="cp-nudge-dismiss"
        onPress={dismiss}
        hitSlop={8}
        style={styles.dismiss}
      >
        <X color={ui.muted} size={16} />
      </PressScale>

      <View style={styles.iconTile}><Users color={ui.orange} size={20} /></View>

      {recover ? (
        <>
          <Text style={styles.title}>
            {recover.reason === 'signed_up' ? t('cp_again_title_tried') : t('cp_again_title_expired')}
          </Text>
          <Text style={styles.body}>{t('cp_again_body', { email: recover.email })}</Text>
          <PressScale
            testID="cp-nudge-resend"
            accessibilityRole="button"
            accessibilityLabel={t('cp_again_cta')}
            onPress={resend}
            disabled={sending || sent}
            style={[styles.cta, (sending || sent) && styles.ctaOff]}
          >
            <Text style={styles.ctaText}>{sent ? t('cp_again_sent') : t('cp_again_cta')}</Text>
            {sent ? null : <ArrowRight color="#fff" size={16} />}
          </PressScale>
        </>
      ) : (
        <>
          <Text style={styles.title}>{t('cp_nudge_title')}</Text>
          <Text style={styles.body}>{t('cp_nudge_body')}</Text>
          <PressScale
            testID="cp-nudge-invite"
            accessibilityRole="button"
            accessibilityLabel={t('cp_share_cta')}
            onPress={shareInvite}
            disabled={sending || sent}
            style={[styles.cta, (sending || sent) && styles.ctaOff]}
          >
            <Text style={styles.ctaText}>
              {sent ? t('cp_share_sent') : sending ? t('cp_share_sending') : t('cp_share_cta')}
            </Text>
            {sent ? null : <ArrowRight color="#fff" size={16} />}
          </PressScale>
          {linkNote ? <Text style={styles.note} selectable>{linkNote}</Text> : null}
          {/* Still reachable for anyone who would rather send it to a specific
              address — just no longer the only way through. */}
          <PressScale
            testID="cp-nudge-by-email"
            accessibilityRole="button"
            accessibilityLabel={t('cp_share_by_email')}
            onPress={onInvite}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>{t('cp_share_by_email')}</Text>
          </PressScale>
        </>
      )}
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  note: {
    color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 8,
  },
  secondary: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  secondaryText: {
    color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13,
  },
  card: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.orangeSoft, padding: 16, marginBottom: 16 },
  dismiss: { position: 'absolute', top: 10, right: 10, padding: 6, zIndex: 1 },
  iconTile: { width: 44, height: 44, borderRadius: 13, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18, letterSpacing: -0.3 },
  body: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 5, marginBottom: 14 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.orange, paddingVertical: 13, borderRadius: 14 },
  ctaText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  ctaOff: { opacity: 0.55 },
});
