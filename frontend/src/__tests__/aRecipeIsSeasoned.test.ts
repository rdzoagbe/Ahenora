/**
 * A recipe tells you to season the food.
 *
 * Reported by a cook reading our generated recipes: no salt, no pepper, no
 * parsley, no thyme. The validator was never the problem — it accepts "to
 * taste" and the screen renders it — the prompt simply never asked. An
 * unseasoned recipe is not a recipe, it is a list of ingredients that happen
 * to be in the same pan.
 */
import * as fs from 'fs';
import * as path from 'path';

const AI_SAFETY = path.join(__dirname, '..', '..', '..', 'backend', 'ai_safety.py');
const read = () => fs.readFileSync(AI_SAFETY, 'utf8');

function promptNamed(name: string): string {
  const src = read();
  const start = src.indexOf(`${name} = """`);
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start + name.length + 7);
  return body.slice(0, body.indexOf('"""'));
}

describe('The recipe writer is told to season the food', () => {
  const prompt = promptNamed('RECIPE_SYSTEM_PROMPT');

  it('asks for salt and pepper', () => {
    expect(prompt.toLowerCase()).toContain('salt');
    expect(prompt.toLowerCase()).toContain('pepper');
  });

  it('asks for the herbs and aromatics the dish is actually made with', () => {
    const lower = prompt.toLowerCase();
    expect(lower).toContain('herbs');
    expect(lower).toContain('aromatics');
  });

  it('says to put them in the ingredients, not leave them to memory', () => {
    expect(prompt.toLowerCase()).toContain('ingredients');
    expect(prompt).toContain('to taste');
  });

  it('says when to season, not only what with', () => {
    // Food salted at the end does not taste the same as food salted as it
    // cooks, so a seasoning ingredient with no step is only half the fix.
    expect(prompt.toLowerCase()).toContain('when to season');
  });
});

describe('Reading a recipe from a photo is left alone', () => {
  it('transcribes what is on the page rather than adding seasoning', () => {
    // Someone photographing their grandmother's recipe wants that recipe, not
    // our opinion of how it should be seasoned.
    const prompt = promptNamed('RECIPE_PHOTO_SYSTEM_PROMPT');
    expect(prompt.toLowerCase()).not.toContain('season the food');
  });
});

describe('The unit list still lets seasoning through', () => {
  it('keeps "to taste" and "pinch" as units the validator accepts', () => {
    // If these were dropped from the closed set, every salt and pepper line
    // the model returned would be thrown away and the recipes would go back
    // to being unseasoned with nothing in the prompt to blame.
    const src = read();
    expect(src).toContain('"to taste": 0');
    expect(src).toMatch(/pinch/);
  });
});
