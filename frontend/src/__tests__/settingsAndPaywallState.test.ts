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
  it('is no longer re-flashed on every focus', () => {
    // This was the actual bug. A useFocusEffect set it true and hid it after
    // two seconds, EVERY time the Kids tab was focused — so the announcement
    // replayed forever. Nothing may set it from a focus effect again.
    expect(KIDS).not.toContain('setShowTeenHint');
    const focusEffect = KIDS.slice(
      KIDS.indexOf('useFocusEffect(useCallback(() => {'),
      KIDS.indexOf('}, []));', KIDS.indexOf('useFocusEffect(useCallback(() => {')));
    expect(focusEffect.length).toBeGreaterThan(20);
    expect(focusEffect).not.toContain('TeenHint');
  });

  it('starts hidden, so a storage failure shows nothing rather than nagging', () => {
    expect(KIDS).toContain('const [teenHintEligible, setTeenHintEligible] = useState(false)');
  });

  it('is shown once and remembered', () => {
    expect(KIDS).toContain('AsyncStorage.getItem(TEEN_HINT_SEEN_KEY)');
    expect(KIDS).toContain("AsyncStorage.setItem(TEEN_HINT_SEEN_KEY, '1')");
  });

  it('marks it seen only once it is really on screen', () => {
    // Reading eligibility on mount is fine; WRITING on mount would burn the
    // announcement for a parent who arrived with a child profile open, since
    // the hint does not render in that state. The write is gated on the same
    // value that decides whether it is drawn.
    expect(KIDS).toContain('const showTeenHint = teenHintEligible && !isFocused;');
    const writer = KIDS.slice(
      KIDS.indexOf('if (!showTeenHint) return;'),
      KIDS.indexOf('}, [showTeenHint]);'));
    expect(writer.length).toBeGreaterThan(20);
    expect(writer).toContain("AsyncStorage.setItem(TEEN_HINT_SEEN_KEY, '1')");
  });

  it('declares the young-role helper before anything uses it', () => {
    // useMemo runs its factory during render, so a helper declared below a
    // useMemo that calls it is a ReferenceError on first paint, not a lint nit.
    // tsc does not catch this shape.
    const helper = SETTINGS.indexOf('const isYoung =');
    const firstUse = SETTINGS.indexOf('members.filter(isYoung)');
    expect(helper).toBeGreaterThan(-1);
    expect(firstUse).toBeGreaterThan(helper);
  });

  it('counts teens as young people, matching the server', () => {
    // The server meters slots with ^(child|teen)$; the client must agree.
    expect(SETTINGS).toContain("const YOUNG_ROLES = ['child', 'teen']");
  });
});
