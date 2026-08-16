// Conservative typed-date detector for the "+" quick-capture smart layer.
//
// Given free text a user typed into a card title, it looks for a CLEAR English
// or French date/time cue and, if one is present, returns a concrete Date plus
// a short human label ("Tue 3:00 PM" / "mar. 15h00"). It errs hard toward
// silence: anything ambiguous returns null so the green "add to Calendar?" chip
// never fires on ordinary text like "buy milk" or "call the plumber".
//
// No heavy library — plain regex + keyword tables. es/de are best-effort: the
// English/French cues still match if present, otherwise it returns null.

export interface DetectedDate {
  date: Date;
  label: string;
}

// dow index matches Date.getDay(): 0 = Sunday.
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
  janvier: 0, 'février': 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, 'août': 7, aout: 7, septembre: 8, octobre: 9, novembre: 10,
  'décembre': 11, decembre: 11,
};

const WEEKDAY_SHORT_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_SHORT_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// The next calendar date landing on `dow`, always strictly in the future
// (if today matches, jump a full week rather than pointing at "now").
function nextWeekday(from: Date, dow: number): Date {
  const base = startOfDay(from);
  let diff = (dow - base.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(base, diff);
}

// Month names sorted longest-first so "february" wins over "feb".
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
const RE_MONTH_DAY = new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})\\b`, 'i');
const RE_DAY_MONTH = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_ALT})\\b`, 'i');

const WEEKDAY_ALT = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
// "next monday" (en) / "lundi prochain" | "prochain lundi" (fr).
const RE_NEXT_WEEKDAY_EN = new RegExp(`\\bnext\\s+(${WEEKDAY_ALT})\\b`, 'i');
const RE_WEEKDAY_PROCHAIN = new RegExp(`\\b(${WEEKDAY_ALT})\\s+prochain\\b`, 'i');
const RE_PROCHAIN_WEEKDAY = new RegExp(`\\bprochain\\s+(${WEEKDAY_ALT})\\b`, 'i');
const RE_WEEKDAY = new RegExp(`\\b(${WEEKDAY_ALT})\\b`, 'i');

// Explicit clock times only — a bare integer never matches.
//   12-hour: 3pm · 3:30pm · 11 am
const RE_TIME_12 = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i;
//   24-hour French: 15h · 15h30 · 9h
const RE_TIME_24 = /\b([01]?\d|2[0-3])\s*h\s*([0-5]\d)?\b/i;

/**
 * Detect a clear date/time cue in `text`. Returns null unless at least a
 * concrete day OR an explicit clock time is present.
 */
export function detectDateTime(text: string, lang: string): DetectedDate | null {
  if (!text) return null;
  const s = text.toLowerCase();
  if (s.trim().length < 3) return null;

  const now = new Date();
  let day: Date | null = null;

  // ── Day component ─────────────────────────────────────────────────────────
  // today / tomorrow
  if (/\b(today|aujourd['’ ]?hui|aujourdhui)\b/.test(s)) {
    day = startOfDay(now);
  } else if (/\b(tomorrow|demain)\b/.test(s)) {
    day = startOfDay(addDays(now, 1));
  }

  // next <weekday>
  if (!day) {
    const m =
      s.match(RE_NEXT_WEEKDAY_EN) || s.match(RE_PROCHAIN_WEEKDAY) || s.match(RE_WEEKDAY_PROCHAIN);
    if (m) {
      const dow = WEEKDAYS[m[1].toLowerCase()];
      if (dow !== undefined) day = nextWeekday(now, dow);
    }
  }

  // month + day  ("Aug 12" / "12 août")
  if (!day) {
    const md = s.match(RE_MONTH_DAY);
    const dm = md ? null : s.match(RE_DAY_MONTH);
    const monthName = md ? md[1] : dm ? dm[2] : '';
    const dayNum = md ? parseInt(md[2], 10) : dm ? parseInt(dm[1], 10) : NaN;
    if (monthName && dayNum >= 1 && dayNum <= 31) {
      const month = MONTHS[monthName.toLowerCase()];
      if (month !== undefined) {
        let cand = new Date(now.getFullYear(), month, dayNum);
        // A month/day already behind us reads as next year.
        if (cand < startOfDay(now)) cand = new Date(now.getFullYear() + 1, month, dayNum);
        if (cand.getMonth() === month && cand.getDate() === dayNum) day = cand;
      }
    }
  }

  // plain weekday ("Monday" / "lundi") → the upcoming one
  if (!day) {
    const m = s.match(RE_WEEKDAY);
    if (m) {
      const dow = WEEKDAYS[m[1].toLowerCase()];
      if (dow !== undefined) day = nextWeekday(now, dow);
    }
  }

  // ── Time component ────────────────────────────────────────────────────────
  let hasTime = false;
  let hour = 9;
  let minute = 0;
  const t12 = s.match(RE_TIME_12);
  const t24 = s.match(RE_TIME_24);
  if (t12) {
    let h = parseInt(t12[1], 10) % 12;
    if (t12[3].toLowerCase() === 'pm') h += 12;
    hour = h;
    minute = t12[2] ? parseInt(t12[2], 10) : 0;
    hasTime = true;
  } else if (t24) {
    hour = parseInt(t24[1], 10);
    minute = t24[2] ? parseInt(t24[2], 10) : 0;
    hasTime = true;
  }

  if (!day && !hasTime) return null;

  // ── Combine ───────────────────────────────────────────────────────────────
  let result: Date;
  if (day) {
    result = new Date(day);
    // Default a sensible hour (9:00) when only a day was named.
    result.setHours(hasTime ? hour : 9, hasTime ? minute : 0, 0, 0);
  } else {
    // Time only → today, rolling to tomorrow if that clock time already passed.
    result = new Date(now);
    result.setHours(hour, minute, 0, 0);
    if (result.getTime() <= now.getTime()) result = addDays(result, 1);
  }

  return { date: result, label: formatLabel(result, lang) };
}

function formatLabel(d: Date, lang: string): string {
  const dow = d.getDay();
  const h24 = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (lang === 'fr') {
    return `${WEEKDAY_SHORT_FR[dow]} ${h24}h${mm}`;
  }
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${WEEKDAY_SHORT_EN[dow]} ${h12}:${mm} ${ampm}`;
}
