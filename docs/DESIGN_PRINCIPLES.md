# Design principles

This app is in production. Families use it every day. These rules exist so
that whoever works on it next — human or AI, this month or next year —
changes it the way its owner would.

## The idea of the app, which is not up for revision

Household COO is a **calm operating system for a family**: two parents, one
household, and nothing shared by accident. It is warm on purpose. The Calm
score, the greeting, the streak chip, the soft palette — these are not
engagement mechanics to be optimised away, they are the product's voice.
An audit that says "the Calm score is not actionable" has misunderstood it:
its job is to make a stretched parent feel the day is under control, not to
be a metric.

What differentiates it is the **trust model**, not the task list:

- Per-item **private vs shared** — cards and vault documents belong to their
  creator until explicitly shared. Search, feeds and exports must never
  widen what the owning screen would show.
- **Attribution** — who added it, who finished it, who handed it to whom.
- **Hand-off that actually reaches the other person**, in their language.
- **Kid mode** — a child gets their own small app, and the household stays
  shut behind `require_user` refusing child sessions centrally.

Any change that weakens one of these is wrong even if it ships clean.

## Production first

- People are using this. **Do not break things that work.** A refactor that
  changes behaviour is a product decision, not a cleanup.
- Server routes reachable by app builds already installed on phones are
  load-bearing, whatever the code looks like. The five invite-acceptance
  routes are the canonical case: delete only with route-telemetry evidence
  (`GET /api/telemetry/invite-routes`).
- Visible product changes (removing a section, moving a screen, changing
  the palette) get proposed to the owner first. Bug fixes do not.

## One screen, one question

Every screen answers exactly one question, and everything on it either
answers that question or sits below the things that do:

| Screen   | The question                                  |
|----------|-----------------------------------------------|
| Feed     | What do I have to do today?                   |
| Calendar | What is coming?                               |
| Kids     | How are the children doing?                   |
| Kitchen  | What are we eating, and what do we need?      |
| Vault    | Where is that document?                       |

Corollaries, each learned the hard way in August 2026:

- **New features do not get a new card on the feed by default.** The feed
  grew to 2.8 screens with the task list at the bottom because three
  features each added a card above it. Work belongs *in* the task list;
  retrospective content (activity, notes, reports) belongs *below* it.
- **Nothing appears twice on one screen.** The activity strip once said
  "Keigh gave Roland the swimming kit" directly above a list showing that
  task under HANDED TO YOU.
- **Nothing appears in two navigation places.** Search lived in the feed
  header and the More sheet; two taps either way, so the duplicate bought
  nothing. Tools live where you reach for them; More is for destinations.
- Before adding anything, ask "does this earn its place on the screen?" —
  not just "does it work?".

## Colour: fills and ink are different things

`UI` in `Kit.tsx` has two kinds of colour and they are not interchangeable:

- **Fills** (`orange`, `mint`, `lavender`, `gold`, `blue`, `star`) paint
  buttons, tiles and chips. They carry the brand.
- **Ink** (`text`, `muted`, every `*Text`, `orangeText`, theme `accentInk`)
  is read. Every ink colour clears WCAG AA (4.5:1) against both its usual
  surface and its own soft tint.
- White text sits on `orangeDeep`, never on brand `orange` (3.1:1).

A measured sweep (`scripts/e2e_contrast.py`, in CI) found 162 unreadable
pieces of text when this distinction did not exist. It enforces 0.

## Measure, don't eyeball — and measure a real household

- Contrast, layout, and "did the scrim render" questions are settled by
  measurement, not screenshots. "Looks fine to me" shipped an unreadable
  Account screen.
- Measure against a **two-week-old household** (co-parent, child, tasks,
  documents, activity), not a fresh account. An empty account hid the fact
  that the feed's first screen showed no tasks at all.
- The nine browser harnesses run on every PR (`scripts/run_harnesses.py`).
  Anything that only ran on one machine has already failed twice for
  machine-specific reasons; "it passes locally" is a weak claim.

## Voice

Copy explains rather than instructs. "Offline — showing your last saved
copy" instead of "You're offline". If a feature needs a sentence of
instructions from its author, the feature is unfinished — put the ability
where the need appears (the hand-over sheet creating the parent PIN inline
is the model).
