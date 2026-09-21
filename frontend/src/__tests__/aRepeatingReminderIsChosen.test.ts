/**
 * A reminder that comes back every week is a standing commitment, so it has
 * to be one somebody made.
 *
 * Reported by a household whose notification "kept coming back". It was doing
 * exactly what it had been told — by nobody. The task repeated, the reminder
 * default is 15 minutes, and the reminder picker sits at the bottom of a
 * scrolling form most people never reach. Every occurrence spawns a fresh
 * card that inherits the reminder, so it recurs for ever.
 *
 * The fix is a question, not a wall: it appears only for a NEW repeating task
 * whose reminder nobody touched, and both answers save.
 */
import * as fs from 'fs';
import * as path from 'path';

const MODAL = path.join(__dirname, '..', 'components', 'AddCardModal.tsx');
const I18N = path.join(__dirname, '..', 'i18n.ts');
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('The question is asked in exactly the case that caused harm', () => {
  const modal = read(MODAL);

  it('asks when a new repeating task carries an untouched reminder', () => {
    expect(modal).toContain("recurrence !== 'none' && reminderMins > 0 && !reminderTouched");
  });

  it('does not ask when the task does not repeat', () => {
    // A one-off reminder is what people want — "I never got a heads-up" is
    // why the default exists at all — so nothing changes there.
    expect(modal).toContain("recurrence !== 'none'");
  });

  it('does not ask when the person already chose for themselves', () => {
    // Touching the picker IS the answer; asking again would be nagging.
    expect(modal).toContain('setReminderTouched(true)');
    expect(modal).toMatch(/onPress=\{\(\) => \{ setReminderMins\(rem\.mins\); setReminderTouched\(true\); \}\}/);
  });

  it('does not ask when editing an existing card', () => {
    // The reminder on a card that already exists was settled when it was made.
    expect(modal).toContain('!editCard && recurrence');
  });
});

describe('Both answers save, because it is a question and not a wall', () => {
  const modal = read(MODAL);

  it('keeping the reminder saves', () => {
    expect(modal).toMatch(/repeat-reminder-keep[\s\S]{0,260}handleSave\(\)/);
  });

  it('turning it off sets it to none and saves', () => {
    expect(modal).toMatch(/repeat-reminder-off[\s\S]{0,300}setReminderMins\(0\)/);
    expect(modal).toMatch(/repeat-reminder-off[\s\S]{0,300}handleSave\(\)/);
  });

  it('marks the choice as made so the question cannot loop', () => {
    // Without this, save re-enters the same branch and the sheet reopens
    // for ever — the bug this feature is about, rebuilt in the fix for it.
    const keep = modal.slice(modal.indexOf('repeat-reminder-keep'));
    expect(keep.slice(0, 260)).toContain('setReminderTouched(true)');
    const off = modal.slice(modal.indexOf('repeat-reminder-off'));
    expect(off.slice(0, 300)).toContain('setReminderTouched(true)');
  });
});

describe('It says what will happen, not which setting is which', () => {
  const i18n = read(I18N);

  it('names the consequence in plain words', () => {
    const body = i18n.match(/\n  addcard_repeat_reminder_body: '([^']*)'/);
    expect(body).not.toBeNull();
    expect(body![1].toLowerCase()).toContain('every time');
  });

  it('has all four lines in all four languages', () => {
    for (const key of [
      'addcard_repeat_reminder_title', 'addcard_repeat_reminder_body',
      'addcard_repeat_reminder_keep', 'addcard_repeat_reminder_off',
    ]) {
      const hits = i18n.match(new RegExp(`\\n  ${key}: `, 'g')) || [];
      expect([key, hits.length]).toEqual([key, 4]);
    }
  });
});
