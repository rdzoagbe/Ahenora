export function pad2(value: number) {
  return String(value).padStart(2, '0');
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

  const time = date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (targetKey === todayKey) return lang === 'es' ? `Hoy · ${time}` : `Today · ${time}`;
  if (targetKey === tomorrowKey) return lang === 'es' ? `Mañana · ${time}` : `Tomorrow · ${time}`;

  return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDetailedDue(value?: string | null, lang: string = 'en') {
  if (!value) return lang === 'es' ? 'Sin fecha' : 'No due date';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return lang === 'es' ? 'Fecha inválida' : 'Invalid date';

  return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
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
