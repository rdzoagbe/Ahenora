/**
 * Three screens that told the user something other than what was true.
 *
 * 1. The Household group header read "N slots" from member_slots_used, which
 *    is every family_members row plus every pending invite — children counted.
 *    A household of two adults and three children announced "5 slots" above a
 *    list showing two people. The header described a different set than the
 *    thing underneath it, which is the same failure as an instrument reporting
 *    a proxy for what it claims to measure.
 *
 * 2. The paywall opened on Yearly for everyone, including a monthly
 *    subscriber, who then read "billed yearly" beneath a price and reasonably
 *    took it as a statement about their own subscription.
 *
 * 3. The teen-accounts hint was `useState(true)` with no setter ever called.
 *    Its own comment claimed it "flashes for a couple of seconds on open, then
 *    hides so it never nags" — behaviour that was never written. It showed on
 *    every visit, forever.
 *
 * Source-level, like the other guideline checks here: what matters is that the
 * screen cannot go back to reading from the wrong quantity.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const SETTINGS = read('app', '(tabs)', 'settings.tsx');
const KIDS = read('app', '(tabs)', 'kids.tsx');
const PRICING = read('src', 'components', 'PricingView.tsx');
const I18N = read('src', 'i18n.ts');

describe('household summary', () => {
  it('no longer labels the group with slot usage', () => {
    // The plan row and the stat box may still show slots — they show the LIMIT
    // beside them, which is what makes the number mean something. The group
    // header may not.
    const header = SETTINGS.slice(
      SETTINGS.indexOf("groupHead('household'"),
      SETTINGS.indexOf('GK.household)', SETTINGS.indexOf("groupHead('household'")));
    expect(header).not.toContain('memberSlotsUsed');
    expect(header).toContain('householdSummary');
  });

  it('counts adults, children and pending invites separately', () => {
    const fn = SETTINGS.slice(
      SETTINGS.indexOf('const householdSummary'),
      SETTINGS.indexOf('}, [adultCount'));
    expect(fn).toContain('adultCount');
    expect(fn).toContain('childMembers.length');
    expect(fn).toContain("i.status === 'pending'");
    expect(fn).not.toContain('memberSlotsUsed');
  });

  it('uses the singular key when there is exactly one', () => {
    const fn = SETTINGS.slice(
      SETTINGS.indexOf('const householdSummary'),
      SETTINGS.indexOf('}, [adultCount'));
    expect(fn).toContain('count === 1');
    expect(fn).toContain('_one');
  });

  it('translates every new key, singular and plural, in all four languages', () => {
    for (const key of [
      'set_adults_count', 'set_adults_count_one',
      'set_children_count', 'set_children_count_one',
      'set_invites_pending_count', 'set_invites_pending_count_one',
    ]) {
      const hits = I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
      expect(hits).toHaveLength(4);
    }
  });
});

describe('paywall billing cycle', () => {
  it('falls back to yearly, which is the offer', () => {
    expect(PRICING).toContain("pickedCycle ?? subscribedCycle ?? 'yearly'");
  });

  it('shows a subscriber their own cycle', () => {
    expect(PRICING).toContain('const subscribedCycle');
    expect(PRICING).toContain('subscription.billing_cycle');
  });

  it('ignores the cycle a FREE family carries', () => {
    // Every family is created with billing_cycle "monthly" whatever it pays,
    // so reading the field unguarded would snap free accounts to monthly and
    // silently delete the yearly default for the people it exists for.
    const guard = PRICING.slice(
      PRICING.indexOf('const subscribedCycle'),
      PRICING.indexOf('const cycle:'));
    expect(guard.length).toBeGreaterThan(20);
    expect(guard).toContain("plan !== 'village'");
  });

  it('lets the user pick, and the pick wins over any later refresh', () => {
    // The pick is the FIRST term of the fallback chain, so once it is set no
    // subscription refresh can drag the toggle back mid-decision.
    expect(PRICING).toContain('onChange={setPickedCycle}');
    expect(PRICING).toMatch(/pickedCycle \?\? subscribedCycle/);
  });

  it('derives the cycle rather than pushing it into state from an effect', () => {
    // An effect would render the wrong value once before correcting it.
    expect(PRICING).not.toContain('setCycle(');
  });
});

describe('teen hint', () => {
  it('starts hidden, so a storage failure shows nothing rather than nagging', () => {
    expect(KIDS).toContain('const [showTeenHint, setShowTeenHint] = useState(false)');
  });

  it('is shown once and remembered', () => {
    expect(KIDS).toContain('TEEN_HINT_SEEN_KEY');
    expect(KIDS).toContain('AsyncStorage.getItem(TEEN_HINT_SEEN_KEY)');
    expect(KIDS).toContain("AsyncStorage.setItem(TEEN_HINT_SEEN_KEY, '1')");
  });

  it('marks it seen on display, because the hint has no dismiss control', () => {
    const effect = KIDS.slice(
      KIDS.indexOf('AsyncStorage.getItem(TEEN_HINT_SEEN_KEY)'),
      KIDS.indexOf('.catch', KIDS.indexOf('AsyncStorage.getItem(TEEN_HINT_SEEN_KEY)')));
    expect(effect).toContain('setShowTeenHint(true)');
    expect(effect).toContain('setItem');
  });
});
