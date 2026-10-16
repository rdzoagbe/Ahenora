/**
 * A day with no clock is shown as a day, and sent as one.
 *
 * The server pins a bare YYYY-MM-DD to noon UTC and marks the card
 * `time_set: false` (tests/test_a_date_without_a_time_keeps_its_day.py). The
 * app's half of the bargain: show "All day" from that flag rather than from
 * a clock reading midnight, never relabel an old card that carries no flag,
 * and send a passport's expiry as the day it is rather than as the UTC moment
 * of local midnight (which was the evening before, and a day early for the
 * co-parent in another timezone).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { localDayIso } from '../utils/date';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('"All day" comes from the flag', () => {
  it('on Home', () => {
    const feed = read('..', 'app', '(tabs)', 'feed.tsx');
    expect(feed).toContain("if (card.time_set === false) return t('feed_all_day');");
    // Absent flag: the old guess, so a real 00:00 card still reads "All day"
    // and a real 07:00 card is never relabelled.
    expect(feed).toContain("if (card.time_set !== true && due.getHours() === 0 && due.getMinutes() === 0) return t('feed_all_day');");
  });

  it('on the Calendar', () => {
    const cal = read('..', 'app', '(tabs)', 'calendar.tsx');
    expect(cal).toContain("if (timeSet === false) return { time: '', ampm: '' };");
    expect(cal).toContain('timeParts(card.due_date, card.time_set)');
  });
});

describe('a passport expiry is sent as a day', () => {
  it('as a bare date, never as the UTC moment of local midnight', () => {
    const vault = read('..', 'app', '(tabs)', 'vault.tsx');
    expect(vault).toContain('const iso = parsed ? localDayIso(parsed) : null;');
    expect(vault).not.toContain('parsed.toISOString()');
  });

  it('localDayIso gives the day where the person is', () => {
    // Local midnight on 14 May, whatever this machine's zone.
    const d = new Date(2030, 4, 14, 0, 0, 0);
    expect(localDayIso(d)).toBe('2030-05-14');
    // 23:59 the same evening is still the same day — toISOString() would not be
    // for anyone east of Greenwich.
    expect(localDayIso(new Date(2030, 4, 14, 23, 59, 0))).toBe('2030-05-14');
  });
});
