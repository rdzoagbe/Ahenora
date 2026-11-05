/**
 * Money, written the way each language writes it.
 *
 * English puts the sign first ("€2.40"); French, Spanish and German write
 * "2,40 €", with a decimal comma and the sign after. The space before the
 * sign is a no-break space, so "2,40" and "€" never land on two lines.
 *
 * Every screen goes through here. Before, each built its own text: the list
 * said "2,40 €", Spending "€2.40", the weekly report a dollar sign and the
 * receipt camera no currency at all.
 */
export const NBSP = ' ';

export function formatMoney(amount: number, lang: string): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const sign = value < 0 ? '−' : '';
  const fixed = Math.abs(value).toFixed(2);
  return lang === 'en'
    ? `${sign}€${fixed}`
    : `${sign}${fixed.replace('.', ',')}${NBSP}€`;
}

/** A plain number in the language's style: "1.234" in English, "1,234" elsewhere. */
export function formatNumber(value: number, lang: string, maxDecimals = 3): string {
  const text = String(Math.round(value * 10 ** maxDecimals) / 10 ** maxDecimals);
  return lang === 'en' ? text : text.replace('.', ',');
}
