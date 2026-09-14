/**
 * The medicines section on a person's record.
 *
 * The record already had a `medications` free-text box. Fine for "penicillin
 * allergy"; useless for what a parent actually walks out of a surgery with —
 * a course, a dose, three times a day, for ten days.
 *
 * So a medicine is a row now, the same shape as a vaccination, and the API is
 * per-entry rather than send-the-whole-list: two parents writing down two
 * different things from two phones must both survive.
 *
 * The rule that shapes it
 * -----------------------
 * Times are explicit clock times, never a frequency. "Three times a day" has
 * to be turned into moments by somebody, and the safe place for that decision
 * is a parent looking at the label — not this code, and emphatically not a
 * model reading a photograph. So the app never renders "3x daily" either: it
 * shows the hours that were chosen, because that is what was agreed.
 *
 * And the app does not decide what a time IS. It splits on commas and lets the
 * server refuse anything that is not "HH:MM", so the phone and the web cannot
 * disagree about whether "8am" counts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MEMBER = readFileSync(
  join(__dirname, '..', '..', 'app', 'member.tsx'), 'utf8');
const API = readFileSync(join(__dirname, '..', 'api.ts'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('the client', () => {
  it('writes one medicine at a time, never the whole list', () => {
    // Sending the array back is how the other parent's row, added between
    // our read and our write, disappears.
    expect(API).toContain('addMedicine:');
    expect(API).toContain('updateMedicine:');
    expect(API).toContain('deleteMedicine:');
    expect(API).toMatch(/updateMedicine[\s\S]{0,200}method: 'PATCH'/);
  });

  it('addresses a medicine by its id, not its position', () => {
    expect(API).toMatch(/medicines\/\$\{medId\}/);
  });

  it('types times as a list of strings rather than a count', () => {
    expect(API).toMatch(/times: string\[\]/);
  });

  it('returns the whole record from every write', () => {
    // So the list redraws from the server rather than from a guess about
    // what the server did with it.
    for (const call of ['addMedicine', 'updateMedicine', 'deleteMedicine']) {
      const at = API.indexOf(`${call}:`);
      expect(API.slice(at, at + 260)).toContain('request<MemberRecord>');
    }
  });
});

describe('the screen', () => {
  it('shows the section', () => {
    expect(MEMBER).toContain('testID="record-medicines"');
    expect(MEMBER).toContain("t('rec_med')");
  });

  it('puts what somebody is taking now above the vaccination history', () => {
    // A carer opening this is far more often checking today's course than
    // last year's booster.
    expect(MEMBER.indexOf('testID="record-medicines"'))
      .toBeLessThan(MEMBER.indexOf('testID="record-vaccinations"'));
  });

  it('hides the section from a reader when there is nothing on it', () => {
    // An empty section invites a parent to fill it and tells a carer nothing.
    expect(MEMBER).toContain('record.can_edit || medicines.length > 0');
  });

  it('renders the chosen times, and never a frequency', () => {
    expect(MEMBER).toContain('m.times.map((at) =>');
    // No "3x a day" anywhere: the whole point of storing moments is that
    // nothing downstream has to turn a frequency back into hours.
    expect(MEMBER).not.toMatch(/times\.length\}\s*(x|×|times a day)/);
  });

  it('leaves the app out of deciding what a time is', () => {
    // Split on commas and let the server refuse the rest, so the phone and
    // the web cannot disagree about whether "8am" counts.
    expect(MEMBER).toContain("text.split(',').map((t2) => t2.trim()).filter(Boolean)");
    expect(MEMBER).not.toMatch(/new Date\([^)]*times/);
  });

  it('names the medicine in the delete confirmation', () => {
    // "Remove this medicine?" on a list of four is a question nobody can
    // answer correctly.
    expect(MEMBER).toContain("t('rec_med_remove_q', { name })");
  });

  it('only offers editing to somebody allowed to edit', () => {
    // A helper reads what a child takes; deciding it is a parent's.
    const at = MEMBER.indexOf('testID="record-medicines"');
    const section = MEMBER.slice(at, MEMBER.indexOf('testID="record-vaccinations"'));
    expect(section).toContain('record.can_edit ? (');
    expect(section).toContain('testID="med-add"');
  });
});

describe('when a write fails', () => {
  it('tells the person which refusal it was', () => {
    // "Could not save" on a bad time sends someone hunting through four
    // fields for a mistake the server already located.
    for (const key of ['rec_med_bad_time', 'rec_med_too_many_times',
                       'rec_med_backwards', 'rec_med_full']) {
      expect(MEMBER).toContain(key);
      expect(inEveryLanguage(key)).toBe(4);
    }
  });

  it('puts the server copy back rather than leaving a dose nobody stored', () => {
    // Same reason as the vaccination path: a dose left on screen that we
    // failed to save is a dose somebody believes is recorded.
    const at = MEMBER.indexOf('const saveMedicine');
    const fn = MEMBER.slice(at, at + 900);
    expect(fn).toContain('api.getMemberRecord(id)');
    expect(fn).toContain("setRecordState('failed')");
  });
});

describe('the strings ship everywhere', () => {
  it('has every label in all four languages', () => {
    for (const key of ['rec_med', 'rec_med_empty', 'rec_med_add', 'rec_med_dose',
                       'rec_med_times', 'rec_med_from', 'rec_med_to',
                       'rec_med_until', 'rec_med_ph_name', 'rec_med_ph_times']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });

  it('shows the time format in the placeholder rather than explaining it', () => {
    // "08:00, 14:00, 20:00" teaches the format in the place the mistake
    // would be made; a paragraph above the field does not.
    expect(I18N).toContain("rec_med_ph_times: '08:00, 14:00, 20:00'");
  });
});

describe('the free-text field is not disturbed', () => {
  it('keeps medications separate from medicines', () => {
    // People have typed into `medications` already and none of it can be
    // safely parsed into a dose. Losing somebody's note about their child's
    // allergy to migrate them into a tidier schema would be a bad trade.
    expect(MEMBER).toContain("'private_hidden' | 'can_edit' | 'vaccinations' | 'medicines'");
    expect(API).toContain('medicines: Medicine[];');
  });
});
