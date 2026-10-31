import React, { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { HOME_HERO_ART } from '../homeHeroArt';

/**
 * The picture at the top of Home, as in the reference Roland chose on
 * 2026-10-31 ("this is the exact view I wanted to have"): a tall picture of a
 * family under the greeting, fading into the page at the top, with the day's
 * card laid over its bottom edge.
 *
 * The artwork comes from src/homeHeroArt.ts. Until there is a picture the
 * household holds the rights to, the drawing below stands in: it is made here,
 * in code, so nothing has to be licensed. One adult with two children, not a
 * couple: many households on Ahenora are two homes, and a picture of two
 * parents together is the wrong one to greet a separated parent with.
 *
 * Only shown in a household with children whose side of the app is on; a
 * couple on Duo gets the greeting and the day, and nothing that assumes a child.
 */
export const HERO_HEIGHT = 250;

type Palette = {
  sky1: string; sky2: string; sun: string; stars: number; hill1: string; hill2: string;
  house: string; roof: string; win: string; tree: string; pants: string; hair: string; string: string;
  adult: string; girl: string; boy: string; kite: string;
};

function palette(dark: boolean, ui: UIColors): Palette {
  return dark
    ? {
        sky1: '#231C3F', sky2: '#4B3052', sun: '#F3E6BF', stars: 1, hill1: '#2C2231', hill2: '#3A2B3F',
        house: '#5A4640', roof: '#7A3E2C', win: '#F6C453', tree: '#2E4A34', pants: '#120D0A', hair: '#1E140F',
        string: ui.muted, adult: ui.blueText, girl: ui.lavenderText, boy: ui.mintText, kite: ui.orange,
      }
    : {
        sky1: '#FDDCBE', sky2: '#FFF4E4', sun: '#F6B54A', stars: 0, hill1: '#E6C29C', hill2: '#F0D6B6',
        house: '#FFFFFF', roof: '#C9643A', win: '#F6C453', tree: '#7FA36B', pants: '#3A2A22', hair: '#1E140F',
        string: ui.muted, adult: ui.blueText, girl: ui.lavenderText, boy: ui.mintText, kite: ui.orange,
      };
}

export function familyIllustration(p: Palette): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -80 390 240" preserveAspectRatio="xMidYMax slice">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky1}"/><stop offset="1" stop-color="${p.sky2}"/></linearGradient></defs>
<rect y="-80" width="390" height="240" fill="url(#sky)"/>
<g fill="#FFFFFF" opacity="${p.stars}"><circle cx="60" cy="-50" r="1.3"/><circle cx="190" cy="-62" r="1.5"/><circle cx="300" cy="-30" r="1.2"/><circle cx="40" cy="30" r="1.5"/><circle cx="86" cy="16" r="1.2"/><circle cx="150" cy="24" r="1.5"/><circle cx="244" cy="18" r="1.2"/><circle cx="282" cy="42" r="1.4"/><circle cx="370" cy="22" r="1.2"/></g>
<circle cx="322" cy="44" r="20" fill="${p.sun}"/>
<path d="M0 112 C 80 82, 160 92, 230 104 S 340 92, 390 96 V160 H0 Z" fill="${p.hill2}"/>
<g transform="translate(262 0)"><rect x="40" y="58" width="7" height="16" fill="${p.roof}"/><rect x="0" y="80" width="54" height="42" fill="${p.house}"/><polygon points="-6,82 27,54 60,82" fill="${p.roof}"/><rect x="21" y="98" width="12" height="24" rx="6" fill="${p.roof}"/><rect x="6" y="90" width="10" height="10" rx="2" fill="${p.win}"/><rect x="38" y="90" width="10" height="10" rx="2" fill="${p.win}"/></g>
<rect x="338" y="96" width="6" height="28" fill="#8A5A3A"/><circle cx="341" cy="88" r="17" fill="${p.tree}"/><circle cx="353" cy="97" r="11" fill="${p.tree}"/>
<path d="M0 134 C 120 112, 260 118, 390 128 V160 H0 Z" fill="${p.hill1}"/>
<path d="M146 88 Q 172 74 194 50" fill="none" stroke="${p.string}" stroke-width="1"/>
<polygon points="196,28 209,43 196,58 183,43" fill="${p.kite}"/><path d="M196 28 V58 M183 43 H209" stroke="#FFFFFF" stroke-width="1" opacity="0.6"/><path d="M196 58 q -4 6 0 10 q 4 4 0 9" fill="none" stroke="${p.kite}" stroke-width="1.5"/>
<g stroke-linecap="round">
<rect x="93" y="108" width="6" height="19" rx="3" fill="${p.pants}"/><rect x="101" y="108" width="6" height="19" rx="3" fill="${p.pants}"/>
<rect x="89" y="82" width="22" height="30" rx="10" fill="${p.adult}"/>
<line x1="90" y1="90" x2="78" y2="103" stroke="#6B3E26" stroke-width="4"/><line x1="110" y1="90" x2="122" y2="103" stroke="#6B3E26" stroke-width="4"/>
<circle cx="100" cy="72" r="10" fill="#6B3E26"/><ellipse cx="100" cy="65.5" rx="10" ry="5.5" fill="${p.hair}"/>
<rect x="65" y="111" width="4" height="15" rx="2" fill="${p.pants}"/><rect x="71" y="111" width="4" height="15" rx="2" fill="${p.pants}"/>
<path d="M61 113 L66 94 H74 L79 113 Z" fill="${p.girl}"/>
<line x1="75" y1="98" x2="78" y2="103" stroke="#9A6238" stroke-width="3.5"/>
<circle cx="62" cy="81" r="4.5" fill="${p.hair}"/><circle cx="78" cy="81" r="4.5" fill="${p.hair}"/>
<circle cx="70" cy="86" r="8" fill="#9A6238"/><ellipse cx="70" cy="80.5" rx="8" ry="4.5" fill="${p.hair}"/>
<rect x="127" y="111" width="4" height="15" rx="2" fill="${p.pants}"/><rect x="133" y="111" width="4" height="15" rx="2" fill="${p.pants}"/>
<rect x="124" y="94" width="16" height="20" rx="7" fill="${p.boy}"/>
<line x1="125" y1="99" x2="122" y2="103" stroke="#7A4A2A" stroke-width="3.5"/><line x1="139" y1="98" x2="146" y2="88" stroke="#7A4A2A" stroke-width="3.5"/>
<circle cx="132" cy="86" r="8" fill="#7A4A2A"/><ellipse cx="132" cy="80.5" rx="8" ry="4" fill="${p.hair}"/>
</g></svg>`;
}

export function HomeHero({ label }: { label: string }) {
  const ui = useUI();
  const { theme } = useStore();
  const dark = theme.mode === 'dark';
  const styles = useMemo(() => createStyles(ui), [ui]);
  const art = dark ? HOME_HERO_ART.dark : HOME_HERO_ART.light;
  const xml = useMemo(() => (art ? null : familyIllustration(palette(dark, ui))), [art, dark, ui]);

  return (
    <View
      style={styles.wrap}
      testID="home-hero"
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {art ? (
        <Image source={art} style={styles.art} resizeMode="cover" />
      ) : (
        <SvgXml xml={xml as string} width="100%" height={HERO_HEIGHT} />
      )}
      {/* The sky runs into the page instead of stopping at an edge. */}
      <LinearGradient
        pointerEvents="none"
        colors={[ui.bg, ui.bg + '00']}
        style={styles.fade}
      />
    </View>
  );
}

function createStyles(ui: UIColors) {
  return StyleSheet.create({
    wrap: { height: HERO_HEIGHT, overflow: 'hidden', backgroundColor: ui.bg },
    art: { width: '100%', height: HERO_HEIGHT },
    fade: { position: 'absolute', left: 0, right: 0, top: 0, height: 64 },
  });
}
