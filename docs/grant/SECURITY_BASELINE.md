# Security baseline

_The controls in place as of 20 September 2026, each named with the code or workflow that enforces it, followed by the gaps we know about. This extends `docs/SECURITY_REVIEW.md` (pre-launch snapshot) for the grant dossier's "security baseline" item._

## Access control

- **Every route authenticates by default.** A test scans the source and fails if any route lacks an auth dependency or a written reason for being public (`tests/test_a_new_endpoint_cannot_be_public_by_accident.py`): 232 guarded, 18 deliberately public (health, legal pages, invite links, webhooks, store version).
- **Authorisation is server-side and role-based**: parent, helper, teen, child. Helpers are refused the vault, billing, member management, invites and expenses (`require_full_member`). Teens see only shared cards and their own (`_teen_can_see`). A child's PIN session reaches five routes. Tested end to end with a real kid token fired at every sensitive route, expecting 403 (`scripts/e2e_kid.py`).
- **Per-item privacy is enforced in the database read**, not the interface: cards (`_card_visible_to`), vault documents (`_may_see_vault_doc`), and only the owner may change who sees a document or delete it.
- **Admin routes** (metrics, error inbox, support) require an allow-listed email (`ADMIN_EMAILS`).

## Authentication and sessions

- Passwords: PBKDF2-HMAC-SHA256, 200,000 iterations, per-user salt (`hash_password`), verified off the event loop.
- Google and Apple sign-in tokens are verified server-side against the providers' keys (`google_id_token`, `apple_auth`).
- Session tokens are random, stored only as SHA-256 hashes, 90-day sliding expiry, held in the phone's secure store (`expo-secure-store`). Changing a password ends every other session; "Sign out on other devices" exists.
- Password reset by one-time code, 15-minute validity.
- Kid mode: a PIN (hashed) on the parent's phone, a separate short-lived kid token.

## Transport, secrets and configuration

- HTTPS everywhere; database over TLS (`mongodb+srv`).
- Secrets live only in Railway and GitHub Actions environment variables. No secret in the repository (CodeQL and GitHub secret scanning run on every push; `.gitignore` covers keys, service accounts and `.env`). Health checks report a secret's length and hash prefix, never its value (`_secret_fingerprint`); log lines have credentials redacted (`_without_credentials`).
- CORS allow-list (`ALLOWED_ORIGINS`); rate limiting per client (120 requests/minute, 60 on auth routes).
- Webhooks from RevenueCat and Stripe are signature-verified.

## Data protection

- Database: MongoDB Atlas M10 dedicated tier, encryption at rest, continuous backups. The application connects as a least-privilege user (`readWrite` on the production database only; separate rights on the drill database).
- **Restore drill**: a scripted dump, restore into a scratch database, verification (counts, dates, orphans) and cleanup, run on 15 and 17 September 2026 and recorded in `docs/runbooks/restore-drill.md`. A backup nobody has restored from is a belief; these are facts.
- Retention rules in `DATA_FLOW_MAP.md`; account deletion and data export are self-service.
- Images are cropped to the document before leaving the server for the AI provider; AI inputs and outputs are gated (`AI_PROCESSING_MAP.md`).

## Software supply chain and quality

- Native dependencies are pinned and gated: a change to the native module list cannot ship over the air (`check-native-deps.js`); the runtime version guards which binaries receive an update.
- Dependabot for dependency updates; CodeQL (Python and JavaScript) on every pull request and on a schedule.
- Test suites: 2,148 backend tests and 884 frontend tests at the time of writing, plus browser harnesses that drive the real web build, run on every pull request. Frontend tests that read backend files run when those files change (`backendFilesAreWatched.test.ts`).
- Every merge deploys through CI; over-the-air updates can be rolled back in one action (`ota-rollback.yml`).

## Monitoring and incident response

- Unhandled errors are recorded without personal data, grouped, and an hourly workflow fails and emails when any occur (`error-watch.yml`). Device-side failed requests are reported to an admin inbox.
- A production smoke test runs on every deploy and on a schedule: health, sign-in, invite, join, message (`prod-smoke.yml`).
- Health endpoints name the cause of a database failure (auth, timeout, unreachable) rather than a generic error.
- Incident playbooks: `docs/RUNBOOK-ota.md`, `docs/runbooks/restore-drill.md`, `docs/DEPLOYMENT_CHECKLIST.md`.

## Known gaps, honestly

1. **No independent penetration test or code audit yet.** The authorisation surface has been reviewed by tests and by the author, not by a third party. The grant budget line "external technical/security expertise" is for this.
2. **Four build-time npm advisories** (metro toolchain); not shipped to users; cleared by the next Expo SDK bump.
3. **No timeout on AI provider calls**; a slow provider slows a scan rather than failing it. Tracked.
4. **Database connection pool settings** are defaults; fine at current scale, to be tuned before growth.
5. **No formal DPIA yet**; see `DATA_FLOW_MAP.md`. Legal advice is budgeted.
6. **Atlas network access** should be a private endpoint or a strict allow-list; the runbook asks the founder to verify this by hand because no code can.
