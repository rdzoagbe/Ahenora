/**
 * Vaccinations on the child record.
 *
 * The screen half of a list that exists because a text field cannot answer
 * "is she due?". So what is tested here is the part a paragraph could not do:
 * the due state, and the table staying in step with the server's field list.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { dueState } from '../vaccinations';

describe('dueState', () => {
  // Fixed "today" so this does not start failing in a month.
  const today = new Date(2026, 8, 11); // 2026-09-11, local midnight

  it('says nothing when there is no next date', () => {
    expect(dueState('', today)).toBe('none');
  });

  it('ignores a date it cannot read rather than guessing', () => {
    // The server refuses these, so seeing one means something else went wrong;
    // the screen must not render "Due" off a string it did not understand.
    for (const bad of ['soon', '11/03/2024', '2024-13-45', '   ']) {
      expect(dueState(bad, today)).toBe('none');
    }
  });

  it('is due on the day itself, not the day after', () => {
    expect(dueState('2026-09-11', today)).toBe('due');
  });

  it('is due when the date has passed', () => {
    expect(dueState('2024-03-11', today)).toBe('due');
  });

  it('warns a month ahead, which is roughly appointment notice', () => {
    expect(dueState('2026-09-12', today)).toBe('soon');
    expect(dueState('2026-10-11', today)).toBe('soon'); // exactly 30 days
  });

  it('stays quiet about a date that is still far off', () => {
    expect(dueState('2026-10-12', today)).toBe('none'); // 31 days
    expect(dueState('2034-03-11', today)).toBe('none');
  });

  it('does not flip state partway through the day', () => {
    // Whole days, not hours: the same date must read the same at 09:00 and
    // at 23:00, or a parent sees "Due" appear over lunch.
    const morning = new Date(2026, 8, 11, 9, 0, 0);
    const night = new Date(2026, 8, 11, 23, 30, 0);
    expect(dueState('2026-09-12', morning)).toBe(dueState('2026-09-12', night));
    expect(dueState('2026-09-11', morning)).toBe(dueState('2026-09-11', night));
  });
});

/**
 * The parts that are not the date rule: the screen, the client and the server
 * agreeing about what a vaccination is, and the section keeping the promises
 * the rest of the record makes.
 */
describe('the vaccination list on the screen', () => {
  const ROOT = join(__dirname, '..', '..');
  const MEMBER = readFileSync(join(ROOT, 'app', 'member.tsx'), 'utf8');
  const API = readFileSync(join(ROOT, 'src', 'api.ts'), 'utf8');
  const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

  it('carries every field the server returns', () => {
    // Read off public_vaccinations, so adding a field there and forgetting the
    // client is a failure here rather than a value silently dropped.
    const block = SERVER.slice(SERVER.indexOf('def public_vaccinations'),
                               SERVER.indexOf('def ', SERVER.indexOf('def public_vaccinations') + 10));
    const fields = [...new Set([...block.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]))];
    expect(fields).toContain('vax_id');
    expect(fields.length).toBeGreaterThanOrEqual(5);
    const iface = API.slice(API.indexOf('export interface Vaccination'),
                            API.indexOf('}', API.indexOf('export interface Vaccination')));
    for (const f of fields) expect(iface).toContain(f);
  });

  it('writes one entry at a time, never the whole list', () => {
    // A PATCH carrying the array would lose whichever parent saved second.
    expect(API).toContain('addVaccination');
    expect(API).toContain('updateVaccination');
    expect(API).toContain('deleteVaccination');
    expect(API).not.toMatch(/vaccinations:\s*Vaccination\[\][^;]*\}\s*\)\s*=>\s*request/);
  });

  it('hides the whole section from a reader with nothing to read', () => {
    // Same reason the blank text fields are hidden: a carer opening this wants
    // the one line that matters, not a section inviting them to fill it.
    expect(MEMBER).toContain('record.can_edit || vaccinations.length > 0');
  });

  it('only offers the add form to somebody who may write', () => {
    const section = MEMBER.slice(MEMBER.indexOf('testID="record-vaccinations"'),
                                 MEMBER.indexOf('rec_ids'));
    expect(section).toContain('vax-add');
    // The add button sits inside a can_edit branch, not next to one.
    const addAt = section.indexOf('testID="vax-add"');
    const gateAt = section.lastIndexOf('record.can_edit ? (', addAt);
    expect(gateAt).toBeGreaterThan(-1);
  });

  it('asks before removing a row', () => {
    // A vaccination deleted by a mis-tap takes its note with it.
    expect(MEMBER).toContain('rec_vax_remove_q');
  });

  it('re-reads from the server when a save fails', () => {
    // A field left showing what we failed to save is a date the parent
    // believes is recorded and is not.
    const save = MEMBER.slice(MEMBER.indexOf('const saveVaccination'),
                              MEMBER.indexOf('const removeVaccination'));
    expect(save).toContain('api.getMemberRecord');
  });

  it('keeps the dates out of the text-field table', () => {
    // RECORD_GROUPS renders strings; a list routed through it would render as
    // "[object Object]".
    const groups = MEMBER.slice(MEMBER.indexOf('const RECORD_GROUPS'),
                                MEMBER.indexOf('function RecordField'));
    expect(groups).not.toContain('vaccinations');
    expect(MEMBER).toContain("'vaccinations'>");
  });
});
