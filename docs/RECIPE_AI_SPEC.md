# Build-ready spec — "Ask the AI for a recipe" (Kitchen)

_Post-launch OTA, not in the 16 Aug launch. Owner: product (Roland). Status: specced, not built. Companion to PLUS_CAPTURE_SPEC.md and TEEN_MODE_SPEC.md._

## 1. Goal
Let a parent type any dish — "fluffy pancakes" — into the Kitchen and get a full, cookable recipe (ingredients + method + time) on the spot, then push its ingredients to the shopping list or drop it onto a day. Today the AI can already write this recipe, but the only way in is "add the dish to the meal plan first, then generate." This adds the direct, obvious entry point.

## 2. User story
> As a parent, I open Kitchen, tap **Ask the AI for a recipe**, type "fluffy pancakes," and in a few seconds I'm reading how to make them — with a button to add the ingredients to my shopping list and a button to cook it on Saturday.

## 3. Why this is cheap to build (reuse map)
Almost everything exists. The new work is one thin endpoint + one search box + wiring into views that already render.

| Need | Already exists | File |
|---|---|---|
| Turn a dish name → structured recipe | `build_recipe_prompt(title, ingredients, lang, diet, variant)` | `backend/ai_safety.py` |
| Recipe safety gate + shape validation | `RECIPE_SYSTEM_PROMPT`, `validate_recipe`, `_BLOCKED_TERMS`, `UnsafeRecipe` | `backend/ai_safety.py` |
| Model call | `_gemini_text(..., fast=True)` | `backend/server.py` |
| AI metering (shared monthly allowance) | `ai_scans_used` vs `sub["limits"]["ai_scans_per_month"]`, guarded `$inc`, `plan_limit_error` | `backend/server.py` |
| Feature gate | `require_feature(user, "meal_planner")` | `backend/server.py` |
| Full-screen recipe view (steps, time, ingredients) | `cookingRecipe` state + render | `frontend/app/(tabs)/kitchen.tsx` |
| Ingredient → shopping-list mapping | `AiIngredient`, `quantityFor`, `shoppingNameFor`, `categoriseShoppingItem`, `api.bulkAddShopping` | `frontend/src/recipeQuantities.ts`, `kitchen.tsx` |
| Add a dish to a day | `api.addMeal` / meal-plan write | `kitchen.tsx`, `src/api.ts` |
| Recipe JSON contract | `{ steps: string[], ingredients?: AiIngredient[], minutes: int, servings?: int }` | `validate_recipe` |

**Net-new: 1 backend endpoint, 1 `api.ts` method, 1 search box + result plumbing in `kitchen.tsx`, ~4 i18n keys × 4 languages.**

## 4. Scope
**In:**
- Free-text dish box in Kitchen → full AI recipe.
- Reuse the existing recipe view to display it.
- "Add ingredients to shopping list" (reuse).
- "Add to a day" (reuse meal-plan write) — optional secondary action.
- Metered + safety-gated exactly like the meal-recipe path.

**Purely additive — nothing is removed (confirmed by owner):**
- The per-day **"Write me a recipe"** (sparkle on a planned meal) stays exactly as-is — decision: **keep both** entry points, this new box does not funnel or replace it.
- The **weekly meal suggestions** (`suggestWeek`), **"Cook it"**, **Capture recipe**, **All recipes** browse, and **Sync to list** all stay unchanged.
- This feature only adds a new entry point above them; it changes no existing control.

**Out (explicitly not now):**
- No new AI budget or pricing — rides the existing monthly AI allowance.
- No persistent "recipe box"/favourites (a later idea; note in §10).
- No image generation of the dish.
- No multi-turn chat — that's what "Ask the chef" already is; this is one-shot generate. The two are complementary (generate the recipe here, then ask the chef a follow-up on it).

## 5. UX
- **Entry point:** a card/box pinned near the top of the Kitchen tab (above or beside the meal planner), label `t('recipe_ai_title')` = "Ask the AI for a recipe", placeholder `t('recipe_ai_placeholder')` = "e.g. fluffy pancakes, chicken curry…". A single text input + a **Cook it** / search button. A `ChefHat`/`Sparkles` icon to signal it's AI.
- **Loading:** button → spinner; reuse the existing recipe-generation loading affordance. Typical latency is the `fast=True` lite model (a few seconds).
- **Result:** opens the **existing full-screen recipe view** (`setCookingRecipe`), showing time, ingredients with amounts, numbered steps. No new screen to design.
- **Actions on the result:**
  1. **Add ingredients to shopping list** — maps `recipe.ingredients` through `shoppingNameFor` + `categoriseShoppingItem` → `api.bulkAddShopping`. (Identical to how a planned recipe already does it.)
  2. **Add to a day** — pick a day → `api.addMeal({ day, title, ingredients })`; the recipe caches onto that meal for free re-open.
  3. **Ask the chef** — hand the dish title to the existing chef box for a follow-up (substitution/faster/vegetarian).
- **Empty/again:** a "Different recipe" affordance can reuse `variant` (skips cache, runs hotter) if we want variety; optional for v1.
- **Respect household diet:** if `family.diet === "vegetarian"`, pass `diet` so the generated recipe is vegetarian without asking — same rule as the planner.

## 6. Backend contract (the one new endpoint)
`POST /api/recipes/generate?lang=<xx>`

```
Body:  { "title": "fluffy pancakes", "diet"?: "vegetarian", "variant"?: 0 }
200:   { "recipe": { steps:[...], ingredients:[{name,amount,...}]?, minutes:int, servings?:int } }
```

Behaviour — essentially `generate_meal_recipe` minus the meal document:
1. `await require_feature(user, "meal_planner")`.
2. `language = lang if lang in RECIPE_LANGUAGE_NAMES else "en"`.
3. `title = sanitize_user_text(payload["title"])`; reject `len(title) < 2` → 400.
4. `diet = normalize_diet(payload.get("diet")) or normalize_diet(family.get("diet"))`; `variant = clamp(0..20)`.
5. AI-limit check: if not admin and `ai_scans_used >= limit` → `plan_limit_error(feature="ai_scans", …)`.
6. If no `GOOGLE_API_KEY` → 503.
7. `_gemini_text(build_recipe_prompt(title, [], RECIPE_LANGUAGE_NAMES[language], diet=diet, variant=variant), system=RECIPE_SYSTEM_PROMPT, fast=True, temperature=0.9 if variant else None)`.
8. `parsed = extract_json(text)`; `recipe = validate_recipe(parsed)`; on `UnsafeRecipe` → 422 "We could not write a recipe for this one."; other exceptions → 502.
9. Guarded meter increment (`$inc ai_scans_used` while `< limit`), same as the meal path.
10. Return `{ "recipe": recipe }`.

**Caching:** this endpoint is stateless (no meal to hang a cache on) — like `ask_the_chef`, each generate is metered and uncached. If the user then "Adds to a day," the meal-plan write stores the recipe so re-opening it later is free (reuses existing meal cache slots).

**Ingredients passed to the prompt:** empty list `[]` (there's no on-hand list yet) — the model produces the ingredients. This is already a supported path (`build_recipe_prompt` treats ingredients as optional).

## 7. Frontend
- `src/api.ts`: add
  ```ts
  generateRecipe: (title: string, lang: string, diet = '', variant = 0) =>
    request<{ recipe: AiRecipe }>(`/recipes/generate?lang=${encodeURIComponent(lang)}`,
      { method: 'POST', body: { title, diet, variant } }),
  ```
  (mirror the `askChef` signature; `AiRecipe` = the shape `aiRecipes` already stores: `{ minutes, steps, servings?, ingredients? }`).
- `kitchen.tsx`: new `recipeAiQuery` state + input; on submit call `api.generateRecipe`, store into `aiRecipes` under a synthetic key, and `setCookingRecipe({ recipeId: <synthetic>, title })` to open the existing viewer. Gate the box behind `!mealLocked` (same `meal_planner` lock the planner uses) and show the existing upgrade affordance when locked.
- Wire the result's "Add to shopping list" / "Add to a day" to the existing handlers (already present for planned recipes).

## 8. i18n (en/fr/es/de) — new keys
`recipe_ai_title`, `recipe_ai_placeholder`, `recipe_ai_cta` ("Cook it"), `recipe_ai_failed` (reuse the meal-recipe failure copy if preferred), `recipe_ai_locked_sub` (upsell line for free plan). French seed:
- `recipe_ai_title`: "Demandez une recette à l'IA"
- `recipe_ai_placeholder`: "ex. pancakes moelleux, curry de poulet…"
- `recipe_ai_cta`: "Cuisiner"

## 9. Safety, cost, abuse
- **Safety:** unchanged — same `RECIPE_SYSTEM_PROMPT` + `validate_recipe` + `_BLOCKED_TERMS` that already gate every generated recipe. Non-food or unsafe asks return 422, not a bad recipe.
- **Cost/abuse:** metered against the existing monthly AI allowance (one number families already understand). Free plan is gated by `meal_planner` feature; paid plan bounded by `ai_scans_per_month`. Admins uncharged (same as today). No new budget line.
- **Input hardening:** `sanitize_user_text` on the title (same as chef/meal paths); title length floor 2.

## 10. Later (not this build)
- Persist generated recipes into a lightweight **"Saved recipes"** list so a good one isn't lost after closing (would reuse the meal cache shape).
- Photo-of-a-dish → recipe (there's already `/recipes/capture` for printed recipes; a "what can I cook from this?" is a different, bigger feature).
- "Cook from what I have" — feed the shopping list / pantry as the `ingredients` arg (the prompt already accepts on-hand ingredients).

## 11. Testing
- **Harness:** add `scripts/e2e_recipe_ai.py` (pattern from `e2e_quickadd.py`): register → unlock `meal_planner` (admin seed) → open Kitchen → type "fluffy pancakes" → assert the recipe view opens with ≥3 steps and a minutes value → tap "Add to shopping list" → assert items landed via `/shopping`. Register it in `scripts/run_harnesses.py`.
- **Backend:** the endpoint reuses tested helpers; add a unit test that a 2-char title 400s, a non-food title 422s (safety gate), and that the meter increments once per successful generate and not on 422.
- **Manual:** verify vegetarian household gets a vegetarian recipe without asking; verify limit-reached shows the upgrade path, not a crash.

## 12. Rollout
- Ship as an **OTA** on the production channel after launch stabilises (same mechanism as the "+"), gated behind the existing `meal_planner` entitlement so it appears only for eligible plans.
- No native change, no store review — pure JS + backend deploy (Railway).

## 13. Effort estimate
- Backend endpoint: ~30 lines (a trim of `generate_meal_recipe`). **~0.5 day.**
- Frontend box + wiring into existing views: **~1 day.**
- i18n + harness + tests: **~0.5 day.**
- **Total ≈ 2 days**, low risk (reuse-heavy, isolated behind a feature gate).
