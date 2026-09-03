import { detectDateTime } from './dateParse';

/**
 * What a line typed into the capture bar is asking for.
 *
 * The bar used to be a button: tap it, a composer opens, you type, you save.
 * Every line became a card, because a card was the only thing it could make —
 * so "ajoute du lait à la liste" became a task about milk, and the shopping
 * list and the meal planner sat behind two more taps each. The app's most
 * capable parts were the hardest to reach.
 *
 * The rule here is deliberately timid. Routing away from a card needs an
 * explicit signal, because guessing wrong is worse than not guessing: a task
 * that lands in the shopping list is a task the person has to go and find. A
 * card is always the fallback, never a guess.
 */
export type CaptureIntent =
  | { kind: 'shopping'; items: string[] }
  | { kind: 'meal'; day: string; title: string }
  | { kind: 'card'; title: string; due: Date | null; dueLabel: string | null };

/** "add … to the list" — the phrasings that mean the shopping list and only it. */
const SHOPPING_LEAD = [
  // English
  /^\s*(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+)?(?:shopping\s+)?list\s*$/i,
  /^\s*(?:buy|get)\s+(.+)$/i,
  /^\s*(?:shopping|groceries)\s*[:\-]\s*(.+)$/i,
  // French
  /^\s*(?:ajoute[rz]?|mets?|mettez)\s+(.+?)\s+(?:à|a|sur|dans)\s+la\s+liste(?:\s+de\s+courses)?\s*$/i,
  /^\s*(?:ach[èe]te[rz]?)\s+(.+)$/i,
  /^\s*(?:courses|liste\s+de\s+courses)\s*[:\-]\s*(.+)$/i,
];

/** A meal, on a named day. Both halves required — see `detectCaptureIntent`. */
const MEAL_WORDS = /\b(d[îi]ner|souper|repas|menu|dinner|supper|lunch|d[ée]jeuner)\b/i;

const DAYS: Record<string, string> = {
  monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday', thursday: 'thursday',
  friday: 'friday', saturday: 'saturday', sunday: 'sunday',
  lundi: 'monday', mardi: 'tuesday', mercredi: 'wednesday', jeudi: 'thursday',
  vendredi: 'friday', samedi: 'saturday', dimanche: 'sunday',
};

/** Split "du lait, du pain et des œufs" into three items. */
function splitItems(text: string): string[] {
  return text
    .split(/\s*,\s*|\s+(?:and|et|&)\s+/i)
    .map((s) => s.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean);
}

function findDay(text: string): string | null {
  for (const [word, day] of Object.entries(DAYS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return day;
  }
  return null;
}

export function detectCaptureIntent(text: string, lang: string, now = new Date()): CaptureIntent | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  for (const pattern of SHOPPING_LEAD) {
    const m = trimmed.match(pattern);
    if (m) {
      const items = splitItems(m[1]);
      // "buy" with nothing after it is not a shopping list, it is somebody
      // starting a sentence.
      if (items.length) return { kind: 'shopping', items };
    }
  }

  // A meal needs BOTH a meal word and a day. "dîner" alone is as likely to be
  // a dinner party to remember as a menu to plan, and "jeudi" alone is every
  // other task anyone types.
  const day = findDay(trimmed);
  if (day && MEAL_WORDS.test(trimmed)) {
    // What is actually being eaten: whatever follows the colon or dash, or —
    // failing that — the line with the meal word and the day taken out.
    const after = trimmed.match(/[:\-–]\s*(.+)$/);
    const title = (after
      ? after[1]
      : trimmed.replace(MEAL_WORDS, ' ').replace(new RegExp(`\\b${Object.keys(DAYS).find((k) => DAYS[k] === day && new RegExp(`\\b${k}\\b`, 'i').test(trimmed))}\\b`, 'i'), ' ')
    ).replace(/\s+/g, ' ').trim();
    if (title) return { kind: 'meal', day, title };
  }

  // Everything else is a card. The date is only ever a suggestion carried
  // alongside — the title stays exactly as typed, the same as the composer,
  // so nobody's words are quietly rewritten.
  const detected = detectDateTime(trimmed, lang);
  return {
    kind: 'card',
    title: trimmed,
    due: detected ? detected.date : null,
    dueLabel: detected ? detected.label : null,
  };
}
