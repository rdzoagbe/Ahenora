import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useStore } from '../store';
import { moneyParts } from '../money';

/**
 * The euro sign beside an amount box, on the side the reader's language puts
 * it: "€ [10]" in English, "[10] €" in French, Spanish and German. Place one
 * before the input and one after; only the right one draws.
 */
export function EuroSign({ side, style, afterStyle }: {
  side: 'before' | 'after';
  style?: StyleProp<TextStyle>;
  /** Extra style when the sign sits after the box (spacing on the other side). */
  afterStyle?: StyleProp<TextStyle>;
}) {
  const { lang } = useStore();
  const first = moneyParts(0, lang).symbolFirst;
  if (first !== (side === 'before')) return null;
  return <Text style={[style, side === 'after' && afterStyle]}>€</Text>;
}
