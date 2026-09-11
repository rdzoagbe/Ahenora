/**
 * A child's key facts, and who is allowed to read them.
 *
 * The app could say what was on today and nothing about the child it was on
 * for — a member row held a name, a picture, an age, a star target and a PIN.
 * The meal planner said the quiet part out loud: "check every dish against any
 * allergies in your family", an app admitting it knows allergies matter and
 * does not know yours.
 *
 * This is a child's health information, so what these guard is not the form —
 * it is where the information must never turn up, and that the screen shows
 * every field the server keeps rather than quietly dropping one.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const MEMBER = readFileSync(join(ROOT, 'app', 'member.tsx'), 'utf8');
const API = readFileSync(join(ROOT, 'src', 'api.ts'), 'utf8');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

/** The field names the server defines, read off the server. */
const serverFields = (name: 'CARE_FIELDS' | 'PRIVATE_FIELDS') => {
  const block = SERVER.slice(SERVER.indexOf(`${name} = (`),
                             SERVER.indexOf(')', SERVER.indexOf(`${name} = (`)));
  return [...new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))].sort();
};

describe('the record the screen shows', () => {
  it('finds the fields at all', () => {
    // A regex that quietly matched nothing would make every check below pass.
    expect(serverFields('CARE_FIELDS').length).toBeGreaterThanOrEqual(10);
    expect(serverFields('PRIVATE_FIELDS').length).toBeGreaterThanOrEqual(2);
  });

  it('shows every care fact the server keeps', () => {
    // Add a field on the server and forget the screen, and a parent fills in
    // an allergy that nobody can ever read back. The table is what makes that
    // a failure here rather than a silence in the app.
    const groups = MEMBER.slice(MEMBER.indexOf('const RECORD_GROUPS'),
                                MEMBER.indexOf('function RecordField'));
    for (const field of serverFields('CARE_FIELDS')) {
      expect({ field, shown: groups.includes(`'${field}'`) })
        .toEqual({ field, shown: true });
    }
  });

  it('keeps the identifiers out of that table', () => {
    // They are rendered apart because they are the half a helper does not get;
    // in the table they would inherit the care tier's visibility.
    const groups = MEMBER.slice(MEMBER.indexOf('const RECORD_GROUPS'),
                                MEMBER.indexOf('function RecordField'));
    for (const field of serverFields('PRIVATE_FIELDS')) {
      expect({ field, inTable: groups.includes(`'${field}'`) })
        .toEqual({ field, inTable: false });
    }
  });

  it('renders the identifiers only when the server sent them', () => {
    expect(MEMBER).toMatch(/record\.private_hidden \? null : \(/);
  });

  it('tells a helper the drawer exists rather than showing nothing', () => {
    // Silence would send them asking a parent for a number already recorded.
    expect(MEMBER).toContain("t('rec_hidden')");
    expect(MEMBER).toContain("t('rec_helper_note')");
  });
});

describe('where it must never go', () => {
  it('is fetched on its own, not folded into the members list', () => {
    // /family/members is fetched by every screen and by helpers. public_member
    // is an explicit allowlist and this is the reason it stays one.
    expect(API).toContain("`/family/members/${memberId}/record`");
    const publicMember = SERVER.slice(SERVER.indexOf('def public_member(member: dict)'),
                                      SERVER.indexOf('def public_handoff_note'));
    expect(publicMember).not.toMatch(/"record"/);
    expect(publicMember).not.toMatch(/allergies|medical_number/);
  });

  it('is read behind a gate that still lets a carer in', () => {
    // A nanny who cannot see the allergy cannot do the job — so the READ is
    // require_user, and the private half is stripped by the serialiser.
    const read = SERVER.slice(SERVER.indexOf('async def get_member_record'),
                              SERVER.indexOf('async def update_member_record'));
    expect(read).toContain('user=Depends(require_user)');
    expect(read).toContain('full_member=not user.get("is_helper")');
  });

  it('is written only by a full member', () => {
    // A helper reads an allergy; they do not get to change one.
    const write = SERVER.slice(SERVER.indexOf('async def update_member_record'),
                               SERVER.indexOf('async def update_member_record') + 400);
    expect(write).toContain('user=Depends(require_full_member)');
  });

  it('patches only the fields it was given', () => {
    // Two parents editing different halves from two phones must not overwrite
    // each other — which needs exclude_unset and a dotted $set, not a whole
    // sub-document replace.
    expect(SERVER).toContain('payload.model_dump(exclude_unset=True)');
    expect(SERVER).toMatch(/f"record\.\{k\}"/);
  });
});

describe('the form itself', () => {
  it('saves when a field is left, not on every keystroke', () => {
    // An allergy typed a letter at a time would otherwise be written sixteen
    // times, and half of those writes would be a half-typed allergy.
    expect(MEMBER).toMatch(/onBlur=\{\(\) => \{ setFocused\(false\); onSave\(draft\.trim\(\)\); \}\}/);
  });

  it('does not yank the text out from under someone mid-edit', () => {
    expect(MEMBER).toMatch(/if \(!focused\) setDraft\(value\)/);
  });

  it('shows a helper the values without an input to type in', () => {
    expect(MEMBER).toMatch(/editable \? \(/);
    expect(MEMBER).toContain("t('rec_empty')");
  });
});

describe('what a carer is shown', () => {
  it('shows them only the facts that are filled in', () => {
    // A carer opening this wants the allergy, and ten rows of "Nothing
    // recorded yet" is where the one line that matters goes to hide.
    const memo = MEMBER.slice(MEMBER.indexOf('const visibleGroups'),
                              MEMBER.indexOf('const [avatar'));
    expect(memo).toMatch(/if \(record\.can_edit\) return RECORD_GROUPS;/);
    expect(memo).toMatch(/\.filter\(\(\[f\]\) => \(record\[f\] \?\? ''\)\.trim\(\)\)/);
    expect(memo).toMatch(/\.filter\(\(g\) => g\.fields\.length > 0\)/);
  });

  it('still shows a parent the blanks', () => {
    // A blank is how a parent knows there is something to fill in.
    const memo = MEMBER.slice(MEMBER.indexOf('const visibleGroups'),
                              MEMBER.indexOf('const [avatar'));
    expect(memo).toContain('return RECORD_GROUPS;');
  });

  it('says so once when a carer would otherwise see nothing at all', () => {
    expect(MEMBER).toMatch(/visibleGroups\.length === 0 \? \(/);
  });
});
