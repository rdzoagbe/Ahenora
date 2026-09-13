/**
 * The day and the time a carpool actually runs on.
 *
 * Carpool Coordinator shipped as a PAID feature that could be listed and
 * deleted and never created: `createCarpool` had no caller, and the Calendar
 * rendered the section only when `carpools.length > 0`. A household that paid
 * for it arrived where it was sold and found nothing at all.
 *
 * These are the rules the create sheet and the server both hold to, so a row
 * that reaches the schedule is one a parent can read at 8am and believe.
 */
import {
  CARPOOL_DAYS, carpoolReady, normaliseCarpoolTime, sortCarpools,
} from '../carpool';

describe('a pickup time', () => {
  it('accepts the clock as somebody would type it', () => {
    expect(normaliseCarpoolTime('08:00')).toBe('08:00');
    expect(normaliseCarpoolTime('8:00')).toBe('08:00');
    expect(normaliseCarpoolTime('8:5')).toBe('08:05');
    expect(normaliseCarpoolTime('  15:30  ')).toBe('15:30');
    expect(normaliseCarpoolTime('23:59')).toBe('23:59');
    expect(normaliseCarpoolTime('0:00')).toBe('00:00');
  });

  it('stores one shape however it was typed', () => {
    // The schedule sorts on this string, so "8:00" and "08:00" sorting apart
    // would put the morning run after the afternoon one.
    expect(normaliseCarpoolTime('8:00')).toBe(normaliseCarpoolTime('08:00'));
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', '   ', 'half eight', '25:00', '12:60', '-1:00',
                       '08', '08:', ':30', '8:00pm', '08:00:00', '١٢:٣٠']) {
      expect(normaliseCarpoolTime(bad)).toBeNull();
    }
  });
});

describe('whether the sheet can save', () => {
  it('needs a name, a real day and a real time', () => {
    expect(carpoolReady('School run', 'monday', '08:00')).toBe(true);
    expect(carpoolReady('', 'monday', '08:00')).toBe(false);
    expect(carpoolReady('   ', 'monday', '08:00')).toBe(false);
    expect(carpoolReady('School run', 'someday', '08:00')).toBe(false);
    expect(carpoolReady('School run', 'Monday', '08:00')).toBe(false);
    expect(carpoolReady('School run', 'monday', 'half eight')).toBe(false);
  });

  it('does not wait for a driver', () => {
    // Plenty of runs are written down before anybody has agreed to drive
    // them. Requiring a name means the schedule never gets written at all.
    expect(carpoolReady('School run', 'friday', '15:20')).toBe(true);
  });

  it('covers all seven days', () => {
    expect(CARPOOL_DAYS).toHaveLength(7);
    for (const day of CARPOOL_DAYS) {
      expect(carpoolReady('Run', day, '09:00')).toBe(true);
    }
  });
});

describe('the schedule reads as a week', () => {
  const rows = [
    { day_of_week: 'friday', time: '15:20' },
    { day_of_week: 'monday', time: '15:20' },
    { day_of_week: 'monday', time: '08:00' },
    { day_of_week: 'sunday', time: '10:00' },
  ];

  it('puts Monday first and then the clock', () => {
    // The server returns newest-first, which is the order things were TYPED.
    // A Friday run entered last would otherwise sit above Monday's.
    expect(sortCarpools(rows).map((r) => `${r.day_of_week} ${r.time}`)).toEqual([
      'monday 08:00', 'monday 15:20', 'friday 15:20', 'sunday 10:00',
    ]);
  });

  it('leaves the array it was given alone', () => {
    const original = [...rows];
    sortCarpools(rows);
    expect(rows).toEqual(original);
  });

  it('sends a row with an unreadable day to the end, not to Monday', () => {
    const odd = sortCarpools([{ day_of_week: 'whenever', time: '08:00' },
                              { day_of_week: 'monday', time: '09:00' }]);
    expect(odd[0].day_of_week).toBe('monday');
  });
});
