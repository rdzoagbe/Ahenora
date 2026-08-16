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
3. **No full audit performed** — every backend endpoint's authorization + session handling was not exhaustively reviewed (only the tested kid boundary).

## Post-launch security pass (prioritized)
1. **Dependency DoS vulns** → Expo/metro bump to clear image-size / js-yaml / nanoid (task #10).
2. **Enable GitHub Advanced Security** → secret scanning + push protection on the repo (task #10).
3. **`.gitignore` hardening** → ✅ done (google-services.json, play-service-account.json, `*service-account*.json`, `*.p12`).
4. **Backend authorization surface review** → walk every route's authz + session checks; ideally an independent review before scale (new task).
5. **Minor-data compliance** → revisit GDPR-K / Age-Appropriate Design Code when Teen mode (task #17) lands, since teens become account holders.
