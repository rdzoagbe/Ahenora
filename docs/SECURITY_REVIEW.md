# Security Review — pre-launch snapshot + post-launch pass

_Scope: the rebrand/nav/"+" changes on this branch, plus a targeted posture check (secrets, dependency vulns, SAST, the tested authz boundary). NOT a full audit or pen-test._

## Verdict
**Ship-safe.** No committed secret, no client-side secret leak, no auth regression, and nothing introduced by our changes. Fundamentals are sound. The residual risk is a **documented, DoS-class dependency-vuln set + hardening gaps**, all post-launch.

## ✅ Verified clean
- **No secrets committed** — no private keys, service-account creds, or real `.env`. The **Play publishing key is not in the repo** (CI injects it at build time). `.env` and `*.pem` are gitignored.
- **No server secrets in the shipped client bundle** (`docs/app`). The key-looking config values (Google OAuth **client IDs**, the RevenueCat `goog_` **publishable** key, `EXPO_PUBLIC_*`) are **public by design**.
- **Release = Google Play App Signing** (no release keystore in the repo; the committed one is the standard *debug* keystore).
- **SAST (CodeQL) green.**
- **Authorization boundary enforced server-side + tested** — `scripts/e2e_kid.py` fires a kid's token directly at `/vault`, `/cards`, `/family/members`, `/activity`, `/shopping`, `/auth/me`, `/search` and asserts **403** on each.
- **Rate limiting** (`RATE_LIMIT_MAX`, `RATE_LIMIT_AUTH_MAX`) and a **CORS allow-list** (`ALLOWED_ORIGINS`) are configured.
- **Our changes add no new attack surface** — no new endpoints, no auth changes, reuse of existing authenticated APIs; the date parser is pure regex (no `eval`/injection).

## ⚠️ Open items (residual, tracked)
1. **12 High npm-audit findings (0 critical)** — all **DoS-class**, 3 roots: `image-size` (ICNS/JXL/HEIF parser infinite loop), `js-yaml` (quadratic CPU via `!!omap`, CVE-2026-59870), `nanoid` (loop when size=0). Most are **build-time tooling** (metro/@expo/cli/react-native), not shipped. `image-size` is the runtime-relevant one. Fix needs an **Expo SDK / metro bump** — risky to force pre-launch; acceptable to launch (DoS, not data-theft). → **task #10**.
2. **GitHub Advanced Security not enabled** — no automated secret scanning / push protection. → **task #10**.
3. ~~**No full audit performed**~~ → ✅ done 2026-10-10, see **Backend authorization walk** below.

## Post-launch security pass (prioritized)
1. **Dependency DoS vulns** → Expo/metro bump to clear image-size / js-yaml / nanoid (task #10).
2. **Enable GitHub Advanced Security** → secret scanning + push protection on the repo (task #10).
3. **`.gitignore` hardening** → ✅ done (google-services.json, play-service-account.json, `*service-account*.json`, `*.p12`).
4. **Backend authorization surface review** → ✅ walked 2026-10-10 (below); an independent outside review before scale is still worth paying for.
5. **Minor-data compliance** → revisit GDPR-K / Age-Appropriate Design Code when Teen mode (task #17) lands, since teens become account holders.

## Backend authorization walk (2026-10-10)

Every route in `backend/server.py` (259 at the time) was listed with its
auth dependency and every database call it makes, and each call's filter was
checked for the household (or owner) scope. Method: a script over the source,
then a hand read of every handler whose filter names an id without a
`family_id` / `user_id` / `member_id`.

**Result: no cross-household gap found.**

- **Session gate.** 242 routes depend on `require_user` (or `require_full_member`,
  `require_teen`, `require_child`, `require_chat_account`, which all start from
  the same session lookup). A child session and a teen session are refused
  there, centrally, before any handler runs.
- **The 17 routes with no session dependency** are, by design, the public
  surface: root, web-push config, app version info, the five auth exchanges and
  the two password-reset steps, the invite preview by token, the shared gift-pot
  view and join by token, the Secret Santa match by token, the Stripe and
  RevenueCat webhooks (signature-checked) and the ops error budget (ops token).
  Every token is from `secrets.token_urlsafe` / `token_hex` and is the
  authorization on its own.
- **Admin surface.** All 24 `/api/admin/*`, `/api/metrics/*` (reads),
  `/api/health/*` and `/api/telemetry/*` (reads) routes check `is_admin_user`
  inside the handler and answer 403 otherwise. The three write-only telemetry
  and metric routes any signed-in user may hit are counters and error reports.
- **Household data.** Every lookup by id on a user-data collection is filtered
  by the caller's `family_id` (plus `created_by_user_id` or `owner_user_id`
  where a thing is one person's), and a miss is a 404, or a 403 where the row
  exists but belongs to someone else in the same household. The by-id writes
  that remain are re-reads of a row the same function already found with the
  household filter, or rows handed in from a token lookup.
- **Two by-design notes, not findings.** Within one household a co-parent may
  edit a private card by id (covered by `tests/test_coparent_can_edit.py`,
  deliberate); and a push token or web-push endpoint is upserted by its value,
  so a caller who knows another device's token string could re-point it at
  their own account (the tokens are not guessable and only steer pushes).

**Held in place by `tests/test_another_household_gets_nothing.py`:** one test
per user-data collection (21 collections) that a parent from a second
household asking for the first household's row by id is refused and nothing
changes, plus a source walk that fails on any new `find_one` / `update_one` /
`delete_one` on a user-data collection whose id comes from the request and
not from a household-scoped lookup. A mutation check (dropping the household
filter from one delete) failed both the per-collection test and the walk.
