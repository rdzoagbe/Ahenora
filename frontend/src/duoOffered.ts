/**
 * Whether Duo is offered on this device.
 *
 * Everywhere but the iPhone, yes: Google Play sells it and the web takes a
 * card. On an iPhone, only once the App Store actually hands out the Duo
 * products — which it does from the day Apple approves them. Until then an
 * iPhone shows no Duo card, no "Subscribe now" to Duo and no Duo news, so
 * nobody is offered something the store would refuse. A household already on
 * Duo (bought elsewhere) always sees its own plan.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { tierReady } from './billing';
import { useStore } from './store';

let iosAnswer: boolean | null = null;

export function useDuoOffered(): boolean {
  const { user } = useStore();
  const [offered, setOffered] = useState<boolean>(Platform.OS !== 'ios' || iosAnswer === true);
  const userId = user?.user_id;
  useEffect(() => {
    if (Platform.OS !== 'ios' || !userId) return;
    let alive = true;
    tierReady(userId, 'duo')
      .then((ok) => {
        // Only a yes is remembered: a no today may be a yes tomorrow.
        if (ok) iosAnswer = true;
        if (alive) setOffered(ok);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [userId]);
  return offered;
}
