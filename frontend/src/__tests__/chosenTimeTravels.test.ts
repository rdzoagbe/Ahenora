/**
 * Whether a time was CHOSEN has to survive the whole way to the card.
 *
 * The clash warning only means anything if both sides had a time somebody
 * picked. Every dated card carries a clock time regardless — a typed "dentist
 * tomorrow" is parsed to 09:00, the calendar's add button defaults to 12:00 —
 * so "has a time" cannot tell a 3pm appointment from a task that needed an
 * hour to sit on.
 *
 * That makes `time_set` a signal with a long journey: picker → sheet →
 * payload → server → back out again on edit. It is worth nothing if any leg
 * drops it, and every leg drops it silently.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { detectDateTime } from '../dateParse';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const PICKER = src('components', 'DateTimePickerSheet.tsx');
const SHEET = src('components', 'AddCardModal.tsx');
const API = src('api.ts');
const I18N = src('i18n.ts');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('typed capture knows the difference', () => {
  it('counts a written clock time as chosen', () => {
    for (const text of ['dentist at 3pm', 'swimming 4:30pm', 'call mum at 9am']) {
      expect(detectDateTime(text, 'en')?.timeChosen).toBe(true);
    }
    expect(detectDateTime('rendez-vous 15h30', 'fr')?.timeChosen).toBe(true);
  });

  it('does not read a bare 24-hour colon time as a time at all', () => {
    // Pre-existing and deliberate: the parser matches 3pm and the French
    // 15h30, and refuses anything that could be a quantity — "swimming 16:30"
    // is not detected, and neither is "buy 16 eggs". Recorded here because it
    // is the difference between a conservative parser and a broken one, and
    // because writing a test against 16:30 is how I first got this wrong.
    expect(detectDateTime('swimming 16:30', 'en')).toBeNull();
  });

  it('does not count the hour it supplies for a bare day', () => {
    // These get 09:00 so the card has somewhere to sit. That is not a choice,
    // and treating it as one is what would make every task clash.
    for (const text of ['dentist tomorrow', 'swimming monday']) {
      const found = detectDateTime(text, 'en');
      expect(found).not.toBeNull();
      expect(found?.timeChosen).toBe(false);
    }
  });

  it('still returns the date either way', () => {
    expect(detectDateTime('dentist tomorrow', 'en')?.date).toBeInstanceOf(Date);
  });
});

describe('the picker reports what the person actually touched', () => {
  it('starts each opening as unchosen', () => {
    // A time chosen for the last card is not a time chosen for this one.
    expect(PICKER).toContain('const [timeChosen, setTimeChosen] = useState(false);');
    expect(PICKER).toContain('setTimeChosen(false);');
  });

  it('counts a slot chip and the typed field, and nothing else', () => {
    expect(PICKER).toContain('setTimeText(slot); setTimeChosen(true);');
    expect(PICKER).toContain('setTimeText(next); setTimeChosen(true);');
    // Picking a DAY is not picking a time, and neither is a quick option.
    expect(PICKER).not.toMatch(/pickDay[\s\S]{0,200}setTimeChosen\(true\)/);
    expect(PICKER).not.toMatch(/applyQuick[\s\S]{0,300}setTimeChosen\(true\)/);
  });

  it('emits it with the value', () => {
    expect(PICKER).toContain('onChange(iso, timeChosen);');
    expect(PICKER).toContain('onChange(null, false);');
  });
});

describe('the sheet carries it to the payload', () => {
  it('takes it from the picker', () => {
    expect(SHEET).toContain('onChange={(value, chosen) => { setDueDate(value); setTimeChosen(chosen); }}');
  });

  it('takes it from an accepted suggestion', () => {
    expect(SHEET).toContain('setTimeChosen(dateSuggest.timeChosen);');
  });

  it('sends it on create and on edit', () => {
    expect(SHEET.match(/time_set: timeChosen,/g) || []).toHaveLength(2);
  });

  it('loads it back when editing, rather than resetting it', () => {
    // This screen already carries the scar: recurrence, the reminder and the
    // room each silently erased themselves on edit before somebody noticed.
    // A flag reset to its create-default would drop the card out of the clash
    // check the first time anybody fixed a typo.
    expect(SHEET).toContain('setTimeChosen(editCard.time_set === true);');
  });

  it('clears it when the due date is cleared', () => {
    expect(SHEET).toContain('onPress={() => { setDueDate(null); setTimeChosen(false); }}');
  });
});

describe('asking, and saying so', () => {
  it('will not ask without a chosen time', () => {
    expect(SHEET).toContain('if (!dueDate || !timeChosen) { setClashes([]); return; }');
  });

  it('tells the server which kind of question it is', () => {
    expect(SHEET).toContain('api.conflicts(dueDate, true, editCard?.card_id)');
    expect(API).toContain('conflicts: (due_date: string, time_set: boolean, exclude_id?: string)');
  });

  it('never lets a failed hint block saving', () => {
    expect(SHEET).toMatch(/catch \{[\s\S]{0,200}setClashes\(\[\]\)/);
  });

  it('shows the warning, and names the thing it clashes with', () => {
    expect(SHEET).toContain('testID="due-clash"');
    expect(SHEET).toContain("t('add_clash_one'");
    expect(SHEET).toContain("t('add_clash_many'");
    for (const key of ['add_clash_one', 'add_clash_many']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});
