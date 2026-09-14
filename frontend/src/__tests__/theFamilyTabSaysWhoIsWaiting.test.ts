/**
 * The Family tab counts the people waiting on a decision, not just the people.
 *
 * When the other four tabs learned to say what a refresh found, this one was
 * deliberately left counting MEMBERS — and the reason was recorded rather than
 * hidden: the teen approvals were loaded by a fire-and-forget call, and a
 * number spoken aloud has to be one the refresh actually waited for.
 *
 * That was the right call and the wrong end state. "1 new thing" after a pull
 * on the Family tab meant a household member had accepted an invitation —
 * true, and roughly once a year. Meanwhile the thing that tab exists for, a
 * child who finished a task and is waiting on a parent to award the star, went
 * unannounced every single time.
 *
 * So the approvals are now awaited. The cost that made me defer it — an extra
 * wait before the roster appears — turned out not to be a cost at all: the
 * request used to be fired only AFTER the members came back, so starting both
 * together makes the approvals arrive strictly sooner, and the only thing that
 * waits is the sentence at the end.
 *
 * The subtlety worth its own test is WHERE the count may be spoken.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { refreshOutcome, onlyWhatIsOnScreen } from '../refreshOutcome';

const KIDS = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'kids.tsx'), 'utf8');

describe('a count the screen is not showing', () => {
  it('is dropped, so nothing points at an invisible card', () => {
    // The approvals card sits behind `!isFocused`. With one child's profile
    // open it is gone from the screen, and "2 waiting for you to decide"
    // would be a prompt to act on something the person cannot see.
    expect(onlyWhatIsOnScreen({ items: 4, waiting: 2 }, false))
      .toEqual({ items: 4 });
  });

  it('is kept when the card is there', () => {
    expect(onlyWhatIsOnScreen({ items: 4, waiting: 2 }, true))
      .toEqual({ items: 4, waiting: 2 });
  });

  it('never drops the items, which are what the screen is a list of', () => {
    expect(onlyWhatIsOnScreen({ items: 7 }, false)).toEqual({ items: 7 });
    expect(onlyWhatIsOnScreen({ items: 0, waiting: 9 }, false)).toEqual({ items: 0 });
  });

  it('leaves a dropped count unable to speak, rather than reading as zero', () => {
    // Both sides filtered: the comparison simply never mentions waiting, so a
    // hidden queue cannot produce news in EITHER direction — not "2 waiting"
    // and not a phantom drop that would mask a genuine new member.
    const before = onlyWhatIsOnScreen({ items: 4, waiting: 0 }, false);
    const after = onlyWhatIsOnScreen({ items: 5, waiting: 2 }, false);
    expect(refreshOutcome(before, after)).toEqual({ key: 'refresh_one_new' });
  });
});

describe('what the Family tab says', () => {
  it('puts a child waiting on a star ahead of a new household member', () => {
    // Both happened. The star is the one that needs a person.
    const before = onlyWhatIsOnScreen({ items: 4, waiting: 0 }, true);
    const after = onlyWhatIsOnScreen({ items: 5, waiting: 1 }, true);
    expect(refreshOutcome(before, after)).toEqual(
      { key: 'refresh_waiting', params: { n: '1' } });
  });

  it('still announces a new member when nothing is waiting', () => {
    expect(refreshOutcome(
      onlyWhatIsOnScreen({ items: 4, waiting: 0 }, true),
      onlyWhatIsOnScreen({ items: 5, waiting: 0 }, true),
    )).toEqual({ key: 'refresh_one_new' });
  });

  it('says nothing changed rather than nothing at all', () => {
    // The original bug, which this tab must not reintroduce by a side door.
    expect(refreshOutcome(
      onlyWhatIsOnScreen({ items: 4, waiting: 2 }, true),
      onlyWhatIsOnScreen({ items: 4, waiting: 2 }, true),
    )).toEqual({ key: 'refresh_up_to_date' });
  });

  it('treats an approved star as up to date, not as a loss', () => {
    // A parent awarding stars empties this queue. That is the parent's own
    // doing, and "2 fewer" would read as though something went missing.
    expect(refreshOutcome(
      onlyWhatIsOnScreen({ items: 4, waiting: 2 }, true),
      onlyWhatIsOnScreen({ items: 4, waiting: 0 }, true),
    )).toEqual({ key: 'refresh_up_to_date' });
  });
});

describe('the tab actually wires it that way', () => {
  it('waits for the approvals instead of firing and forgetting them', () => {
    // The whole reason this was deferred. `.then(...)` with nothing awaiting
    // it is what made the count unspeakable.
    expect(KIDS).toContain('const approvalsPromise = api.getTeenApprovals()');
    expect(KIDS).toContain('const waiting = await approvalsPromise;');
    expect(KIDS).not.toMatch(/api\.getTeenApprovals\(\)\.then\([^)]*\)\.catch/);
  });

  it('starts both requests together so the roster is not held up', () => {
    // Awaiting a request that has not been SENT yet would be a real cost.
    // These leave side by side, so the await at the end is free.
    expect(KIDS).toContain('const membersPromise = api.familyMembers();');
    expect(KIDS).toMatch(
      /const membersPromise[\s\S]{0,120}const approvalsPromise[\s\S]{0,400}await membersPromise/);
  });

  it('reports the roster even if something below it fails', () => {
    // loaded is set as soon as the members land, then enriched.
    expect(KIDS).toContain('loaded = { items: m.length };');
    expect(KIDS).toContain('loaded = { items: m.length, waiting: waiting ?? undefined };');
  });

  it('reads a failed approvals call as unknown rather than as empty', () => {
    expect(KIDS).toContain('.catch(() => { setTeenApprovals([]); return null; });');
  });

  it('gates the spoken count on the card being on screen', () => {
    expect(KIDS).toContain('const speaks = !focusedRef.current;');
    expect(KIDS).toContain('const before = onlyWhatIsOnScreen(seen, speaks);');
    expect(KIDS).toMatch(/refreshOutcome\(before, onlyWhatIsOnScreen\(\{/);
  });

  it('holds both counts and the gate in refs, not in dependencies', () => {
    // Same reason as every other tab: in the dependency list the handler is
    // rebuilt on each load and the RefreshControl is handed a new function
    // mid-pull.
    for (const ref of ['membersRef', 'waitingRef', 'focusedRef']) {
      expect(KIDS).toContain(`${ref} = useRef`);
      expect(KIDS).toContain(`${ref}.current =`);
    }
    expect(KIDS).toMatch(/\}, \[load, showToast, t\]\);/);
  });
});
