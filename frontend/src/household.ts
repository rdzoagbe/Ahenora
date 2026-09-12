/**
 * Who counts as an adult in a household.
 *
 * This exists because the co-parent nudge — the one prompt that asks for the
 * second adult, and the thing the app's own growth depends on — was gated on
 * `members.length <= 1`. That list is every row in the household, children
 * included, so the nudge vanished the moment a parent added a child.
 *
 * And the Getting Started checklist's FIRST step is "add a member". So the app
 * asked for the second adult exactly once, during onboarding, and then the very
 * next thing it told you to do switched the question off for good. Across 87
 * households that produced seven invitations in thirty days.
 *
 * The rule already existed on the server (`_is_parent_role`); the client
 * counted heads instead. One shared function now, because "who is an adult" is
 * the kind of thing that goes wrong quietly when two places answer it.
 */

/** Parent-level: the founder and any co-parent. A child, a teen, a grandparent
 *  or a nanny invited as a helper are all members, and none of them is this. */
export function isParentRole(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase();
  return r === 'parent' || r === 'co-parent';
}

/** How many parent-level adults the household has. */
export function adultCount(members: { role?: string | null }[] | null | undefined): number {
  return (members || []).filter((m) => isParentRole(m?.role)).length;
}

/**
 * Is this household still one adult?
 *
 * Deliberately `< 2` rather than `=== 1`: a household that somehow reports zero
 * parent rows is also not a shared household, and should still be asked.
 */
export function isSoloHousehold(members: { role?: string | null }[] | null | undefined): boolean {
  return adultCount(members) < 2;
}
