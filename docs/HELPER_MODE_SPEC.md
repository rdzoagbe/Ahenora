# Helper mode — spec

A **helper** is a trusted adult with a login but a *limited* view of the
household — a grandparent, nanny, or babysitter who helps run the day but has no
business in the family's private matters. It is the third kind of account:

| Account   | Access                                             |
|-----------|----------------------------------------------------|
| Co-parent | Full — everything.                                 |
| Teen      | Their own walled world (just their tasks/agenda).  |
| **Helper**| **A restricted member**: the shared day, not the private business. |

Unlike a teen (fully walled off — `require_user` 403s a teen token), a helper is
a *real family member* who uses the normal app, but is **denied the sensitive
surfaces server-side**. Deny-by-default, the same security discipline as teen
mode, proven by tests.

## Permission model (slice 1 — household-wide)

| Helper **can**                                   | Helper **cannot**                          |
|--------------------------------------------------|--------------------------------------------|
| See the shared family calendar                    | See the document vault                     |
| See tasks/chores (assigned to them or the kids)   | See or change billing / plans              |
| Complete a task or chore                          | Add/remove members or invite anyone        |
| See kids' schedules & routines                    | See expenses / money                       |
|                                                   | Award or adjust stars (a parent action)    |

**Backend:** helpers carry `users.is_helper = true` (mirrors `is_teen`) and the
member role `helper`. A new `require_full_member` dependency 403s a helper (and
teen) and is applied to the sensitive routes — vault, subscription change,
member management, invites, expenses. Everything else stays on `require_user`,
so a helper can read the calendar, see tasks, and complete them.

**Frontend:** the helper uses the normal app; the sensitive entry points (vault,
billing, "add member/helper", expenses) are hidden when `user.is_helper`.

## Invite flow
Parent → **"Add a helper"** → email + a role label ("Grandma", "Nanny") → invite
sent → helper accepts, signs in, and lands in the normal app minus the private
surfaces.

A helper counts toward the household's `max_members` cap but **not** the
young-people (kids + teens) cap, and needs no age. Like a teen invite it skips
the two-parent cap (a helper is never a co-parent).

## Ties to the Household tier
Helper accounts are the headline of the held **Household** pricing tier
(grandparents, carers). Slice 1 ships the feature unlocked (consistent with the
current testing window, where everything is Premium); the plan gate — a
`helpers` limit flag checked at invite time — attaches when the Household tier
goes live. Positioning now, one-line gate later.

## Out of slice 1 → slice 2
- **Per-kid scoping** (a helper linked to only certain children). Slice 1 is
  household-wide-shared, which fits a grandparent; per-kid matters more for a
  nanny watching one child.
- Helper messaging, helper-specific notifications, helpers awarding stars.

## Deliverables (slice 1)
- Backend: `is_helper` flag + `helper` role; `require_full_member` guard applied
  to vault / subscription-change / member-management / invite / expenses routes;
  invite + provisioning path; `public_user` exposes `is_helper`.
- Frontend: `is_helper` on the user; hide the sensitive entry points; the
  "Add a helper" invite UI.
- i18n in all four languages.
- Security tests: a helper is denied vault / billing / member-management /
  invite (403) and allowed the calendar / tasks / completing them.
