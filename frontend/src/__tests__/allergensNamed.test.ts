/**
 * The meal planner knows the allergies now, so it says them.
 *
 * Every allergen warning in the kitchen used to hand the question back:
 * "check every dish against any allergies in your family". That is an app
 * telling you it knows allergies matter and does not know yours — and it was
 * the clearest evidence that the app held what a family DOES and nothing about
 * who a family IS.
 *
 * Three states, and the difference between the last two is the whole point:
 * named when we know them, a nudge when we know we don't, and the original
 * warning while the answer is still in flight. "No allergies recorded" and
 * "nobody in this family has allergies" look identical on a screen and must
 * never read the same.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const KITCHEN = readFileSync(join(ROOT, 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
const I18N = readFileSync(join(ROOT, 'src', 'i18n.ts'), 'utf8');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

const note = () => KITCHEN.slice(KITCHEN.indexOf('const allergenNote'),
                                 KITCHEN.indexOf('const allergenNote') + 700);

describe('the allergen warning', () => {
  it('names them when the household has recorded some', () => {
    expect(note()).toMatch(/a\.name.*a\.allergies/);
    expect(note()).toContain("t('allergens_named'");
  });

  it('asks for them when none are recorded', () => {
    // Not silence, and not a claim that nobody has any.
    expect(note()).toMatch(/allergies\.length === 0/);
    expect(note()).toContain("t('allergens_none')");
  });

  it('keeps the old warning while the answer is still loading', () => {
    // A reassuring silence during a fetch is the one outcome that could get
    // somebody hurt.
    expect(note()).toMatch(/allergies === null/);
    expect(note()).toContain("t('cook_allergen_note')");
  });

  it('says it in every place the screen warns', () => {
    // Three: the suggestions sheet, a recipe, a captured recipe. The person
    // cooking may not be the parent who planned the week, and whichever door
    // they came in by has to carry the same words.
    expect((KITCHEN.match(/allergenNote\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // And no site OUTSIDE the helper still says the old words directly — that,
    // not the count, is what catches a fourth warning added later without the
    // names. The helper itself keeps that key on purpose, for the state where
    // the answer has not arrived.
    const outsideHelper = KITCHEN.slice(0, KITCHEN.indexOf('const allergenNote'))
      + KITCHEN.slice(KITCHEN.indexOf('}, [allergies, t]);'));
    expect(outsideHelper).not.toMatch(/cook_allergen_note/);
    expect(outsideHelper).not.toMatch(/suggest_allergen_note/);
  });

  it('has words for all four languages', () => {
    for (const key of ['allergens_named', 'allergens_none']) {
      expect(I18N.match(new RegExp(`${key}:`, 'g')) ?? []).toHaveLength(4);
    }
  });
});

describe('what reaches the kitchen', () => {
  it('is readable by whoever is cooking, not only a parent', () => {
    const route = SERVER.slice(SERVER.indexOf('async def family_allergies'),
                               SERVER.indexOf('async def family_allergies') + 1400);
    expect(route).toContain('user=Depends(require_user)');
  });

  it('carries the allergy and the name, and nothing else', () => {
    // A recipe screen has no business holding a health-service number. The
    // route builds its rows explicitly rather than handing over the record.
    const route = SERVER.slice(SERVER.indexOf('async def family_allergies'),
                               SERVER.indexOf('async def family_allergies') + 1400);
    expect(route).toMatch(/"member_id":/);
    expect(route).toMatch(/"name":/);
    expect(route).toMatch(/"allergies":/);
    for (const field of ['medical_number', 'doctor_name', 'medications', 'insurance_policy']) {
      expect({ field, leaked: route.includes(field) }).toEqual({ field, leaked: false });
    }
  });

  it('leaves out anyone with nothing recorded', () => {
    // A row reading "Ama: nothing" is worse than no row — it reads as a
    // cleared allergy rather than an unasked question.
    const route = SERVER.slice(SERVER.indexOf('async def family_allergies'),
                               SERVER.indexOf('async def family_allergies') + 1400);
    expect(route).toMatch(/\.strip\(\)/);
    expect(route).toMatch(/if allergies:/);
  });
});
