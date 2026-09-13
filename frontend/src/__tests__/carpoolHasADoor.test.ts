/**
 * The Calendar shows Carpool Coordinator to the household that paid for it.
 *
 * The section was written `carpools.length > 0 ? (…) : null`, and nothing in
 * the app called `createCarpool`. So a household on a paid plan unlocked
 * "Carpool Coordinator", went to the Calendar, and found nothing — not an
 * empty list, no section at all — while the locked state above it advertised
 * the feature to everyone who had not paid.
 *
 * Source-level on purpose: these are rules about what the screen must offer,
 * which survive any refactor of how it renders.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CALENDAR = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'calendar.tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('the section is there whether or not it has anything in it', () => {
  it('no longer hides itself when the schedule is empty', () => {
    expect(CALENDAR).not.toContain('carpools.length > 0 ? (');
    expect(CALENDAR).toContain('carpools.length === 0 ? (');
    expect(CALENDAR).toContain("t('cal_carpool_empty')");
  });

  it('offers a way to make the first row', () => {
    expect(CALENDAR).toContain('testID="carpool-add"');
    expect(CALENDAR).toContain('onPress={openCarpool}');
    expect(CALENDAR).toContain('api.createCarpool({');
  });

  it('keeps the paywalled state for households that have not paid', () => {
    // The fix must not hand the feature to the free plan by accident.
    expect(CALENDAR).toContain("promptUpgrade('carpool')");
    expect(CALENDAR).toContain('carpoolLocked ? (');
  });
});

describe('the create sheet', () => {
  it('asks for the four things a schedule row needs', () => {
    for (const id of ['carpool-title', 'carpool-time', 'carpool-driver', 'carpool-save']) {
      expect(CALENDAR).toContain(`testID="${id}"`);
    }
    expect(CALENDAR).toContain('testID={`carpool-day-${day}`}');
  });

  it('will not save something the server would refuse', () => {
    // The button is disabled on exactly the condition the server enforces,
    // so the failure is visible before the tap rather than as a toast after.
    expect(CALENDAR).toContain('disabled={cpSaving || !carpoolReady(cpTitle, cpDay, cpTime)}');
    expect(CALENDAR).toContain('normaliseCarpoolTime(cpTime)');
  });

  it('sends the padded time, not the raw typing', () => {
    expect(CALENDAR).toMatch(/time: when,/);
  });

  it('names the days from the dictionary the rest of the app uses', () => {
    // Not a second set of day names to keep in sync with the first.
    expect(CALENDAR).toContain('t(`day_${day}`)');
    expect(CALENDAR).toContain('t(`day_${cp.day_of_week}`)');
    expect(CALENDAR).not.toContain('cal_day_');
    for (const day of ['monday', 'friday', 'sunday']) {
      expect(inEveryLanguage(`day_${day}`)).toBe(4);
    }
  });

  it('has its words in every language the app ships', () => {
    for (const key of ['cal_carpool_add', 'cal_carpool_save', 'cal_carpool_empty',
                       'cal_carpool_what', 'cal_carpool_which_day',
                       'cal_carpool_what_time', 'cal_carpool_who_drives',
                       'cal_carpool_who_rides', 'cal_carpool_notes',
                       'cal_carpool_needs_time', 'cal_carpool_added']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});

describe('deleting a run', () => {
  it('asks in a way that works on the web too', () => {
    // It was a bare Alert.alert, which renders NOTHING on React Native Web —
    // so on ahenora.com the delete button did nothing at all, silently.
    expect(CALENDAR).toContain('onPress={() => confirmDeleteCarpool(cp)}');
    expect(CALENDAR).toContain("if (webConfirm(t('cal_carpool_delete_msg'))) remove();");
    expect(CALENDAR).toMatch(/Alert\.alert\(t\('cal_carpool_delete_title'\)/);
  });
});

describe('the sheet looks like the feature it belongs to', () => {
  it('uses its own save button rather than the custody one', () => {
    // custodySaveBtn is lavender because custody is the lavender feature.
    // Borrowing it put a purple primary button on an orange sheet.
    expect(CALENDAR).toContain('styles.cpSaveBtn');
    expect(CALENDAR).toMatch(/cpSaveBtn: \{[^}]*backgroundColor: ui\.orange/);
  });

  it('keeps the driver hint short enough to read in every language', () => {
    // It was a sentence ("Leave blank until somebody offers"), which clipped
    // mid-word in French and read as truncated rather than as optional.
    // A placeholder is a hint, not an instruction.
    const hints = I18N.split('\n')
      .filter((l) => /^\s*["']?cal_carpool_who_drives_hint["']?:/.test(l));
    expect(hints).toHaveLength(4);
    for (const line of hints) {
      const value = /:\s*["'](.+)["'],?\s*$/.exec(line.trim())?.[1] ?? '';
      expect(value.length).toBeLessThanOrEqual(20);
    }
  });

  it('fits all seven days on one row', () => {
    // Sized by padding, the widest day pushed Sunday onto a line of its own,
    // which reads as a row that failed to fit rather than as a week.
    expect(CALENDAR).toContain("cpDayRow: { flexDirection: 'row', gap: 5 }");
    expect(CALENDAR).toMatch(/cpDayChip: \{ flex: 1, minWidth: 0/);
  });
});

describe('the schedule reads in day order', () => {
  it('sorts rather than trusting the order they were typed in', () => {
    expect(CALENDAR).toContain('sortCarpools(carpools).map(');
  });
});
