# AI safety checklist

**This is a blocking gate, not a guideline.** No new AI feature ships until
every box below is ticked for it. The roadmap names AI Chef (fridge scan) as
the next one; this exists so that decision is made against a written standard
rather than in the moment.

The reason for the standard: this app's AI output reaches a parent who is about
to cook for their children. A wrong answer here is not a bad recommendation, it
is a meal.

---

## Why this is stricter than it looks

Every AI feature in this app **degrades gracefully** — a failed scan falls back
to a stub card, a failed meal plan falls back to the offline engine. That is
right for users and terrible for us: it means a broken AI feature looks
identical to a working one from the outside.

That is not hypothetical. A retired model name failed **every AI call in
production for weeks** while each feature quietly showed its fallback, and
nothing surfaced it. Assume the same of anything new.

---

## 1. Input — before it reaches the model

- [ ] **All user text passes `sanitize_user_text()`.** Strips prompt-injection
      phrasing, newlines that fake prompt structure, and invisible characters
      (zero-width, direction-override) that hide text from a human reviewer
      while the model still reads it.
- [ ] **All lists pass `sanitize_ingredients()`** — truncated and capped, so a
      pathological input cannot blow out the prompt.
- [ ] **Length is bounded** before the call, not after.
- [ ] The system prompt is passed as `system_instruction` on the config, **not
      concatenated into user content** where the user can address it.

## 2. Output — before it reaches a person

- [ ] **A validator exists in `ai_safety.py` for this feature's shape**, and the
      handler cannot return model output that has not been through it.
- [ ] **Non-food substances are rejected** (`bleach`, `detergent`, `antifreeze`
      and the rest of the blocklist). Tested, not assumed.
- [ ] **An explicit refusal from the model is honoured**, not unwrapped.
- [ ] **Prompt leakage is rejected** — "as an AI language model…" and similar
      never reach the screen.
- [ ] **Wrong shapes fail closed.** Missing fields, wrong types, absurd numbers:
      either repaired to something safe or rejected outright. Never rendered.
- [ ] **A rejected response falls back to the offline path**, and the fallback
      produces a complete result — never a half-filled week or a blank day.

## 3. What the person is told

- [ ] **The allergen note is on every surface where the output can be acted
      on** — not only the one where the ingredients happen to be listed. The
      suggestions sheet needed its own because "Add all to planner" commits a
      week without opening a single dish.
- [ ] **AI-generated content is labelled as such** where it differs in
      reliability from curated content (`cook_ai_note`).
- [ ] The wording is in **all four locales**, and reads naturally in each.

## 4. Failure is visible

- [ ] **`/api/health/ai` reports the new feature** in its `features` list.
- [ ] **Errors are classified, never echoed.** `summarize_ai_error()` returns a
      category; raw exception text carries stack frames, internal URLs and
      project ids, and CodeQL rightly flags returning it to external callers.
      The full text belongs in the logs.
- [ ] **Model failures walk the candidate chain** where that can help
      (`model_not_found`, `quota_exhausted`) and fail fast where it cannot
      (auth, permission, safety). Retrying an auth failure across three models
      triples the pain for no benefit.
- [ ] **No hardcoded model name.** `DEFAULT_CANDIDATES` leads with a `-latest`
      alias, because a pinned version rots silently — three pinned names once
      cost a failed API call on every process start before the chain found a
      live model.

## 5. Cost and abuse

- [ ] **The call is gated by plan and quota** before it is made, not after.
- [ ] **The endpoint refuses to run on insufficient input.** Meal planning
      returns 422 on a near-empty shopping list rather than inventing a week —
      history may enrich a real list, never substitute for one.
- [ ] **Rate limits exist** on anything an unauthenticated or cheap path can
      reach. `/api/health/ai?probe=1` is one probe a minute, globally.

## 6. Tested, and the tests would fail without the fix

- [ ] Tests exist in `tests/test_ai_safety.py` for the new validator, written
      **on the assumption that the model will misbehave** — not that it usually
      behaves.
- [ ] **Every guard is mutation-checked**: remove it, confirm a test goes red,
      put it back. A test that passes either way is decoration.
- [ ] The stdlib-only rule holds where it applies — the safety gate must not be
      able to fail because an install failed.

---

## Specifically for AI Chef (fridge scan), when it comes

The above, plus:

- [ ] **A photographed item is a guess, and is presented as one.** Vision
      misreads packaging. Never add a recognised item to the shopping list
      silently — propose, let the parent confirm.
- [ ] **Nothing is inferred about what is safe to eat.** No use-by dates, no
      freshness, no "this looks fine". The app cannot see mould.
- [ ] **Photographs of people are rejected**, not described. A fridge scan will
      eventually capture a child.
- [ ] The image is handled under the same retention rules as the vault, and is
      not kept server-side after the call returns.
