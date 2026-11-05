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

// The languages that write a decimal comma and put the sign after. Anything
// else, an unknown or missing language included, falls back to English, the
// same fallback dates use (localeFor).
const COMMA_LANGS = new Set(['fr', 'es', 'de']);

function usesComma(lang: string | undefined): boolean {
  return COMMA_LANGS.has(String(lang || '').slice(0, 2));
}

/**
 * The pieces of an amount, for layouts that style the sign apart from the
 * number (the plan cards). `whole` drops ",00" from a round amount.
 */
export function moneyParts(
  amount: number,
  lang: string | undefined,
  { whole = false }: { whole?: boolean } = {},
): { sign: string; number: string; symbolFirst: boolean } {
  // Rounded before the sign is chosen: -0.004 is "0,00 €", not "−0,00 €".
  const cents = Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  const abs = Math.abs(cents) / 100;
  const text = whole && cents % 100 === 0 ? String(abs) : abs.toFixed(2);
  const comma = usesComma(lang);
  return {
    sign: cents < 0 ? '−' : '',
    number: comma ? text.replace('.', ',') : text,
    symbolFirst: !comma,
  };
}

export function formatMoney(amount: number, lang: string | undefined): string {
  const { sign, number, symbolFirst } = moneyParts(amount, lang);
  return symbolFirst ? `${sign}€${number}` : `${sign}${number}${NBSP}€`;
}

/** An amount with two decimals and no sign, for an input box: "9,95" / "9.95". */
export function formatDecimal(amount: number, lang: string | undefined): string {
  return moneyParts(amount, lang).number;
}

/** A plain number in the language's style: "1.234" in English, "1,234" elsewhere. */
export function formatNumber(value: number, lang: string | undefined, maxDecimals = 3): string {
  const text = String(Math.round(value * 10 ** maxDecimals) / 10 ** maxDecimals);
  return usesComma(lang) ? text.replace('.', ',') : text;
}
