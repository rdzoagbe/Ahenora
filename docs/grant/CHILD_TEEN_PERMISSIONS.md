# Child and teen permissions, and parental controls

_What each kind of young person can see and do in Ahenora, and what a parent controls. Written from the code as of 20 September 2026; the app's privacy policy says the same in plain words._

## The principle

A young child is never an account. A teenager is an account with a narrow lens. A parent is in control of both, and everything a child or teen sees is something a parent chose to make visible.

## Children under 13: a profile, not a user

| | |
| --- | --- |
| Created by | A parent, in the app, with a name and optionally an age. No email, no password, no login. |
| Data held | Name, age, avatar, PIN hash, stars and rewards, notes a parent writes, and any health record a parent chooses to keep (vaccinations, medicines, allergies). All of it is provided by the parent, who consents on the child's behalf and can see, correct or delete it at any time. |
| How the child uses the app | **Kid mode** on a parent's phone: the parent hands over the phone, the child enters their PIN. The session is a separate short-lived token. |
| What kid mode can do | See their own jobs for today with icons, tick a job done, see notes a parent wrote to them, request a reward with their stars, exit. That is the whole list: five routes (`/api/kid/home`, `/api/kid/notes`, `/api/kid/chores/{id}/done`, `/api/kid/rewards/{id}/request`, `/api/kid/exit`). |
| What kid mode cannot reach | The vault, other people's cards, the calendar, chat between adults, family members, settings, billing, search. Verified by a test that fires a kid token at each and expects 403 (`scripts/e2e_kid.py`). |
| Stars | Only ever awarded by a parent's decision. Finishing a job offers stars to the parent; nothing pays out automatically. |
| Messages to a child | One-way: a parent writes, the child reads in kid mode. A child cannot send from a shared phone. |
| Exit | The parent's PIN, or the account password if forgotten (`/api/kid/exit-forgot-pin`). |

## Teens 13 to 17: their own account, a narrow view

| | |
| --- | --- |
| Created by | A parent sends a teen invitation; the teen makes an account with it. The parent decides that the teen has an account at all. |
| What a teen sees | Cards that are shared with the whole household, cards assigned to them, and cards they created (`_teen_can_see`). Never another member's private card, never a card scoped to the parents. |
| What a teen does | Their own tasks and routines, their stars and pocket money, the teen chat thread with their parents, RSVP to what concerns them. |
| What a teen cannot reach | The vault, billing, member management, invites, expenses, the adults' chat thread, the health records. Teen sessions are refused by the general route guard (`require_user` rejects a teen token on adult routes). |
| Money | Pocket money is a record kept by the parent; no payment instrument is attached to a teen. |
| Counting | Teens count against the household's child limit, so a teen account is never a way around the plan's cap. |

## Helpers (grandparents, carers)

Adults invited with the helper role use the normal app for the shared day, and are refused the sensitive surfaces server-side: the vault, billing, member management, invites and expenses (`require_full_member`, error `helper_mode`). They see a child's record without its private section (`public_member_record(full_member=False)`).

## What a parent controls

- Who is in the household: invitations, roles, removal.
- Whether a child exists in the app at all, and everything recorded about them.
- The PIN, and the exit from kid mode.
- Whether an item is shared with the household, kept private, or shared with named people (`visible_to`).
- Rewards and their cost; every star awarded.
- Notifications per category, per device.
- Deletion: a parent can delete a child profile, or their own account, or the whole household when they are the last adult.

## What we do not do

- No advertising, no third-party analytics, no profiling of children.
- No location tracking; a card's "location" is a text field a person types.
- No child-facing messaging to anyone outside the household.
- No AI feature is available in kid mode.

## Compliance notes for the dossier

- Age-appropriate design: kid mode is deliberately minimal, large targets, no settings, no exit without a parent's PIN.
- GDPR Article 8: consent for a child under the age of digital consent is given by the parent, who creates and controls the profile; no data is collected from the child directly.
- Health records are special-category data recorded by a parent for their own child; a DPIA screening is recommended (`DATA_FLOW_MAP.md`).
