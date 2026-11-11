/**
 * Health details are not lost by mistake (Roland, 2026-11-11), and a parent
 * can still erase one: deleting is how consent to keep it is withdrawn, which
 * the GDPR requires to be possible at any time and as easy as giving it
 * (art. 7(3)), with erasure "without undue delay" (art. 17(1)(b)).
 *
 * So: a medicine that is no longer taken is STOPPED and kept among the past
 * ones; erasing asks first, naming what goes, erases on the server at once,
 * and offers it back for 10 seconds from what the phone still holds.
 */
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const MEMBER = fs.readFileSync(path.join(root, 'app', 'member.tsx'), 'utf8');
const I18N = fs.readFileSync(path.join(root, 'src', 'i18n.ts'), 'utf8');
const TOAST = fs.readFileSync(path.join(root, 'src', 'hooks', 'useToast.ts'), 'utf8');
const SERVER = fs.readFileSync(path.join(root, '..', 'backend', 'server.py'), 'utf8');

describe('a medicine no longer taken', () => {
  it('can be stopped instead of erased, and taken again', () => {
    expect(MEMBER).toContain('onPress={() => stopMedicine(m, true)}');
    expect(MEMBER).toContain('onPress={() => stopMedicine(m, false)}');
    expect(MEMBER).toContain("saveMedicine(m.med_id, { stopped_on: stop ? today : '' });");
  });

  it('is kept under "Médicaments passés", apart from what is taken now', () => {
    expect(MEMBER).toContain('const pastMedicines = allMedicines.filter((m) => m.stopped_on);');
    expect(MEMBER).toContain('testID="record-medicines-past"');
    expect(I18N).toContain("rec_med_past: 'Médicaments passés',");
  });

  it('is stored stopped on the server, and a stopped day must be a real day', () => {
    expect(SERVER).toContain('hit["stopped_on"] = _clean_date(sent["stopped_on"], "stopped_on")');
  });
});

describe('erasing a health detail', () => {
  it('asks first, naming exactly what goes and that it is erased at once', () => {
    expect(MEMBER).toContain("Alert.alert(t('rec_med_remove_q', { name: m.name }), t('rec_health_erase_body')");
    expect(MEMBER).toContain("Alert.alert(t('rec_vax_remove_q', { name: v.name }), t('rec_health_erase_body')");
    expect(I18N).toContain("rec_health_erase_body: 'Il est effacé tout de suite. Vous aurez 10 secondes pour annuler.',");
  });

  it('erases on the server first, then offers it back for 10 seconds', () => {
    const med = MEMBER.slice(MEMBER.indexOf('const removeMedicine = useCallback'), MEMBER.indexOf('const stopMedicine'));
    expect(med.indexOf('await api.deleteMedicine(id, m.med_id)')).toBeLessThan(med.indexOf('offerHealthUndo('));
    expect(MEMBER).toContain('}, HEALTH_UNDO_MS);');
    expect(TOAST).toContain('export const HEALTH_UNDO_MS = 10000;');
  });

  it('"Annuler" writes back everything that was erased, stopped day included', () => {
    expect(MEMBER).toContain('ends_on: m.ends_on, note: m.note, stopped_on: m.stopped_on,');
    expect(MEMBER).toContain('name: v.name, given_on: v.given_on, next_due: v.next_due, note: v.note,');
  });

  it('undoes once however often it is tapped', () => {
    expect(MEMBER).toContain('if (pressed) return;');
  });

  it('never goes to Récemment supprimés', () => {
    const kinds = SERVER.slice(SERVER.indexOf('TRASH_KINDS = {'), SERVER.indexOf('def _trash_private_to'));
    expect(kinds).not.toMatch(/medic|vaccin|health/i);
  });

  it('is worded in all four languages', () => {
    for (const key of ['rec_med_stop', 'rec_med_resume', 'rec_med_past', 'rec_med_stopped_on',
      'rec_med_none_now', 'rec_health_erase_body', 'rec_health_erased', 'rec_vax_remove_q']) {
      expect([key, (I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length]).toEqual([key, 4]);
    }
  });
});
