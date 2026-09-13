/**
 * Who counts as an adult — and why the app stopped asking for the second one.
 *
 * The co-parent nudge is the one prompt that asks for the other parent, and the
 * component's own docstring calls it "the growth+retention lever for a family
 * app". It was gated on `members.length <= 1`.
 *
 * That list is every row in the household. Children are rows. So adding a child
 * made the count 2 and the nudge disappeared — permanently, for that household.
 * And the Getting Started card's FIRST step is "add a member", so the app asked
 * for the second adult once during onboarding and then immediately told you to
 * do the thing that switched the question off.
 *
 * Across 87 households that produced seven invitations in thirty days.
 *
 * The rule already existed on the server (`_is_parent_role`). The client
 * counted heads instead. These hold the two halves together.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { adultCount, isParentRole, isSoloHousehold } from '../household';

const me = { role: 'parent' };
const coParent = { role: 'co-parent' };
const child = { role: 'child' };
const teen = { role: 'teen' };
const nanny = { role: 'helper' };
const gran = { role: 'grandparent' };

describe('isParentRole', () => {
  it('accepts the two parent-level roles', () => {
    expect(isParentRole('parent')).toBe(true);
    expect(isParentRole('co-parent')).toBe(true);
  });

  it('matches however the role is cased or spaced', () => {
    // Roles arrive from the server and from older rows; "Co-parent" is what
    // the invite form sends.
    expect(isParentRole('Co-parent')).toBe(true);
    expect(isParentRole('  PARENT ')).toBe(true);
  });

  it('is nobody else', () => {
    for (const role of ['child', 'teen', 'helper', 'grandparent', 'member', '', null, undefined]) {
      expect(isParentRole(role as string)).toBe(false);
    }
  });
});

describe('a household with children is still a household with one adult', () => {
  it('THE REGRESSION: one parent and a child is solo', () => {
    // members.length is 2 here. This is the exact case that switched the
    // nudge off, and the first thing the app asks a new household to do.
    expect(isSoloHousehold([me, child])).toBe(true);
    expect(adultCount([me, child])).toBe(1);
  });

  it('three children do not make a second adult', () => {
    expect(isSoloHousehold([me, child, child, child])).toBe(true);
  });

  it('a teen is not a second adult', () => {
    // A 13-17 account is a member with their own gated space, not a co-parent.
    expect(isSoloHousehold([me, teen])).toBe(true);
  });

  it('a nanny or a grandparent is not a second adult', () => {
    // They are adults, and they are not who the prompt is about: a helper
    // cannot carry the household, which is why helper_accounts is a separate
    // paid feature rather than a co-parent.
    expect(isSoloHousehold([me, nanny])).toBe(true);
    expect(isSoloHousehold([me, gran])).toBe(true);
  });

  it('stops being solo when a co-parent joins', () => {
    expect(isSoloHousehold([me, coParent])).toBe(false);
    expect(isSoloHousehold([me, coParent, child, nanny])).toBe(false);
    expect(adultCount([me, coParent, child, nanny])).toBe(2);
  });

  it('treats an empty or unloaded household as solo rather than done', () => {
    // While members are still loading, "not yet a shared household" is the
    // honest answer. Reporting the opposite would hide the prompt on every
    // first render.
    expect(isSoloHousehold([])).toBe(true);
    expect(isSoloHousehold(null)).toBe(true);
    expect(isSoloHousehold(undefined)).toBe(true);
  });

  it('survives a row with no role at all', () => {
    expect(isSoloHousehold([me, {}])).toBe(true);
  });
});

/**
 * And that the Feed actually uses it.
 *
 * The helper above can be perfect while the screen still counts heads — which
 * is precisely the state this repository was in. A pure function passing its
 * own tests proves nothing about the gate that shipped.
 */
describe('the Feed gates the co-parent nudge on adults', () => {
  const feed = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'feed.tsx'), 'utf8');

  it('asks isSoloHousehold rather than counting rows', () => {
    expect(feed).toContain('visible={isSoloHousehold(members)}');
  });

  it('no longer carries the head count that caused this', () => {
    // `members.length <= 1` as a stand-in for "one adult".
    expect(feed).not.toMatch(/visible=\{members\.length\s*<=\s*1\}/);
  });

  it('imports the shared rule instead of redefining it', () => {
    // Two answers to "who is an adult" is how the server and the client drifted
    // apart in the first place.
    expect(feed).toContain("from '../../src/household'");
    expect(feed).not.toMatch(/role\s*===\s*'co-parent'/);
  });

  it('the server and the client agree on which roles are parent-level', () => {
    // _is_parent_role is the original; household.ts must not quietly widen it.
    const server = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'server.py'), 'utf8');
    const block = server.slice(server.indexOf('def _is_parent_role'),
                               server.indexOf('def _is_parent_role') + 400);
    for (const role of ['parent', 'co-parent']) {
      expect(block).toContain(`"${role}"`);
    }
    expect(isParentRole('parent')).toBe(true);
    expect(isParentRole('co-parent')).toBe(true);
    // Anything the server would refuse, the client refuses too.
    for (const role of ['child', 'teen', 'helper']) {
      expect(block).not.toContain(`"${role}"`);
      expect(isParentRole(role)).toBe(false);
    }
  });
});
