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
