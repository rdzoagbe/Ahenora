/**
 * What a line typed into the capture bar is asking for.
 *
 * The whole risk of this feature is a wrong guess. A task that lands in the
 * shopping list is a task the person has to go and find, so the rule is: a card
 * unless the line explicitly says otherwise. Most of these tests are about what
 * must NOT be re-routed.
 */
import { detectCaptureIntent } from '../captureIntent';

const at = (text: string, lang = 'en') => detectCaptureIntent(text, lang, new Date('2026-09-03T09:00:00Z'));

describe('the shopping list', () => {
  it('takes an explicit "add to the list"', () => {
    expect(at('add milk to the list')).toEqual({ kind: 'shopping', items: ['milk'] });
    expect(at('ajoute du lait à la liste', 'fr')).toEqual({ kind: 'shopping', items: ['du lait'] });
  });

  it('takes "buy" and "achète"', () => {
    expect(at('buy bread')).toEqual({ kind: 'shopping', items: ['bread'] });
    expect(at('achète du pain', 'fr')).toEqual({ kind: 'shopping', items: ['du pain'] });
  });

  it('takes a labelled list', () => {
    expect(at('courses : lait, pain et œufs', 'fr'))
      .toEqual({ kind: 'shopping', items: ['lait', 'pain', 'œufs'] });
  });

  it('splits on commas and on "and"/"et"', () => {
    expect(at('add milk, bread and eggs to the list'))
      .toEqual({ kind: 'shopping', items: ['milk', 'bread', 'eggs'] });
  });

  it('is not fooled by the word "list" in the middle of a task', () => {
    // "Make a list of who is coming" is a task about a list, not a list.
    expect(at('make a list of who is coming')!.kind).toBe('card');
  });

  it('does not take a bare verb with nothing after it', () => {
    expect(at('buy')!.kind).toBe('card');
  });
});

describe('the meal planner', () => {
  it('takes a meal with a day', () => {
    expect(at('dîner jeudi : poulet rôti', 'fr'))
      .toEqual({ kind: 'meal', day: 'thursday', title: 'poulet rôti' });
    expect(at('dinner thursday: roast chicken'))
      .toEqual({ kind: 'meal', day: 'thursday', title: 'roast chicken' });
  });

  it('needs BOTH a meal word and a day', () => {
    // A dinner with no day is as likely to be an event to remember as a menu
    // to plan; a day with no meal word is every other task anyone types.
    expect(at('dinner with Marc')!.kind).toBe('card');
    expect(at('dentist thursday')!.kind).toBe('card');
    expect(at('appeler le dentiste jeudi', 'fr')!.kind).toBe('card');
  });

  it('works without a colon', () => {
    const out = at('lundi repas lasagnes', 'fr');
    expect(out).toMatchObject({ kind: 'meal', day: 'monday' });
    expect((out as any).title).toContain('lasagnes');
  });

  it('does not become a meal with a day but nothing to eat', () => {
    // "dinner thursday" alone says when, not what — that is a card.
    expect(at('dinner thursday')!.kind).toBe('card');
  });
});

describe('everything else is a card', () => {
  it('keeps the title exactly as typed', () => {
    const out = at('sign the school slip on Thursday');
    expect(out).toMatchObject({ kind: 'card', title: 'sign the school slip on Thursday' });
  });

  it('carries the date it detected without rewriting the words', () => {
    const out = at('dentist tomorrow at 3pm') as any;
    expect(out.kind).toBe('card');
    expect(out.due).toBeInstanceOf(Date);
    expect(out.title).toBe('dentist tomorrow at 3pm');
  });

  it('has no date when there is none to find', () => {
    const out = at('call the plumber') as any;
    expect(out.kind).toBe('card');
    expect(out.due).toBeNull();
    expect(out.dueLabel).toBeNull();
  });

  it('returns nothing for an empty line', () => {
    expect(at('')).toBeNull();
    expect(at('   ')).toBeNull();
  });
});
