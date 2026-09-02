export function pad2(value: number) {
  return String(value).padStart(2, '0');
}

// Map the app's language to a BCP-47 locale for date formatting. Passing
// `undefined` to toLocaleDateString uses the DEVICE locale, so a French user on
// an English phone saw English day letters ("M T W T F S S") and "Tue" — this
// keeps dates in the app's chosen language instead.
export function localeFor(lang?: string): string {
  switch (lang) {
    case 'es': return 'es-ES';
    case 'fr': return 'fr-FR';
    case 'de': return 'de-DE';
    default: return 'en-US';
  }
}

export function toLocalDateInput(value?: string | null) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return toLocalDateInput(null);
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function toLocalTimeInput(value?: string | null) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return '18:00';
  }

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function buildLocalDateTimeIso(dateText: string, timeText: string) {
  const cleanDate = dateText.trim();
  const cleanTime = timeText.trim() || '18:00';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    throw new Error('Use date format YYYY-MM-DD');
  }

  if (!/^\d{2}:\d{2}$/.test(cleanTime)) {
    throw new Error('Use time format HH:mm');
  }

  const [year, month, day] = cleanDate.split('-').map(Number);
  const [hour, minute] = cleanTime.split(':').map(Number);

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date/time');
  }

  return date.toISOString();
}

export function quickDueDate(option: 'today' | 'tomorrow' | 'weekend') {
  const date = new Date();

  if (option === 'today') {
    date.setHours(18, 0, 0, 0);
    return date.toISOString();
  }

  if (option === 'tomorrow') {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }

  const day = date.getDay();
  const daysUntilSaturday = day === 6 ? 0 : (6 - day + 7) % 7;

  date.setDate(date.getDate() + daysUntilSaturday);
  date.setHours(10, 0, 0, 0);

  return date.toISOString();
}

export function formatCompactDue(value?: string | null, lang: string = 'en') {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const todayKey = toLocalDateInput(now.toISOString());
  const targetKey = toLocalDateInput(value);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toLocalDateInput(tomorrow.toISOString());

  const localeMap: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };
  const locale = localeMap[lang] ?? 'en-US';

  const todayLabels: Record<string, string> = { en: 'Today', es: 'Hoy', fr: "Aujourd'hui", de: 'Heute' };
  const tomorrowLabels: Record<string, string> = { en: 'Tomorrow', es: 'Mañana', fr: 'Demain', de: 'Morgen' };

  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (targetKey === todayKey) return `${todayLabels[lang] ?? todayLabels.en} · ${time}`;
  if (targetKey === tomorrowKey) return `${tomorrowLabels[lang] ?? tomorrowLabels.en} · ${time}`;

  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDetailedDue(value?: string | null, lang: string = 'en') {
  const noDateLabels: Record<string, string> = { en: 'No due date', es: 'Sin fecha', fr: 'Pas de date', de: 'Kein Fälligkeitsdatum' };
  const invalidLabels: Record<string, string> = { en: 'Invalid date', es: 'Fecha inválida', fr: 'Date invalide', de: 'Ungültiges Datum' };
  const localeMap: Record<string, string> = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' };
  const locale = localeMap[lang] ?? 'en-US';

  if (!value) return noDateLabels[lang] ?? noDateLabels.en;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return invalidLabels[lang] ?? invalidLabels.en;

  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isOverdue(value?: string | null) {
  if (!value) return false;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return false;

  return date.getTime() < Date.now();
}

/**
 * ISO-8601 week number, and whether it is even. French custody judgments are
 * written as "semaines paires / impaires", so separated co-parents plan their
 * whole fortnight by this number — it belongs beside the date. Weeks start on
 * Monday and week 1 is the one holding the year's first Thursday (the ISO rule),
 * so late-December / early-January dates land in the right week and parity.
 */
export function isoWeek(d: Date): { week: number; even: boolean } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;             // Mon=1 … Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day);  // shift onto the week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, even: week % 2 === 0 };
}

/** Which parity of ISO week the children are in *this* home, for alternating
 *  custody (garde alternée). A French judgment is written as semaines paires /
 *  impaires, so the parity of the week is the whole schedule. */
export type CustodyWeeks = 'even' | 'odd';

/**
 * True when the children are with this household in the week containing `date`.
 * `ourWeeks` is the parity a parent set as theirs, so an even week is ours when
 * we hold the even weeks, and an odd week is ours when we hold the odd ones.
 * The year-boundary quirk (a 53-week year puts two odd weeks back to back) is
 * inherent to how paire/impaire is legally defined and is left as-is on purpose.
 */
export function custodyIsOurs(date: Date, ourWeeks: CustodyWeeks): boolean {
  const { even } = isoWeek(date);
  return ourWeeks === 'even' ? even : !even;
}

/**
 * The month grid, Monday first.
 *
 * It used to start on Sunday (`getDay()`, where Sunday is 0), which is the US
 * convention and wrong twice over here. France reads a calendar L M M J V S D,
 * and — the part that actually matters — alternating custody is decided by ISO
 * week parity, and an ISO week starts on Monday. A Sunday-first row spans TWO
 * custody weeks, so the colour changed halfway along it: correct per day, and
 * unreadable as a schedule. Monday first makes every row exactly one custody
 * week in one colour, which is how a judgment written in semaines paires /
 * impaires is meant to be read.
 */
export function buildMonthDays(baseDate: Date) {
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const last = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  const leading = (first.getDay() + 6) % 7;   // Monday = 0 … Sunday = 6
  const total = leading + last.getDate();
  const trailing = Math.ceil(total / 7) * 7 - total;
  const days: { date: Date; inMonth: boolean }[] = [];

  for (let i = leading; i > 0; i -= 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1 - i), inMonth: false });
  }
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), day), inMonth: true });
  }
  for (let i = 1; i <= trailing; i += 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, i), inMonth: false });
  }
  return days;
}
