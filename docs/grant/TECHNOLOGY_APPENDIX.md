# Technology appendix

_Architecture, the AI component, what is technically uncertain, and the development roadmap. Written from the code as of 21 September 2026 for the grant dossier. Every figure in it is counted from the source, not estimated._

## 1. What exists

Ahenora is a live family-coordination platform on three surfaces from one codebase: Android (Google Play), iOS (App Store) and the web (ahenora.com/app), in English, French, Spanish and German.

| Layer | Technology | Size |
| --- | --- | --- |
| Mobile and web app | React Native with Expo (SDK 57), TypeScript, Expo Router | 36 screens, 53 dependencies |
| Backend | Python, FastAPI, async | 252 API routes, 548 functions in the core service |
| Database | MongoDB Atlas (M10 dedicated), 34 collections, 62 indexes | |
| AI | Google Gemini API (2.5 Flash, 2.0 Flash fallback) behind an input gate, an output validator and a health check | 11 AI-assisted routes |
| Native | Document scanner, secure store, push, file system, image picker, sharing | 37 pinned native modules |
| Delivery | GitHub Actions: tests, CodeQL, browser harnesses, over-the-air updates with rollback, store builds, smoke tests, error watch | 14 workflows |
| Quality | 2,227 backend tests, 1,000 frontend tests, browser harnesses on the real web build | |

Runtime gate: a native change ships only through the stores and bumps the runtime version; JavaScript changes ship over the air the same day to every phone on that runtime. A test refuses any over-the-air update that introduces a native dependency.

## 2. Architecture

```
Phone / browser ──TLS──▶ FastAPI on Railway ──TLS──▶ MongoDB Atlas
        │                       │
        │                       ├──▶ Gemini API (only on a person's request)
        │                       ├──▶ Expo push / Web Push
        │                       ├──▶ Resend (email)
        │                       └──▶ RevenueCat / Stripe (billing)
        └── Google / Apple sign-in tokens, verified server-side
```

Design choices that matter for the programme:

- **One household state, per-item privacy.** Every card and document carries who may see it; the rule is applied in the database read, and the same rule serves the feed, the calendar, search, the export and the notifications.
- **Every input route converges on a card.** Typed, spoken, scanned, imported from Google Calendar: each becomes the same object with a type, an icon, a date, an assignee and a visibility, so the calendar, reminders and kid mode do not care how a thing arrived.
- **Server-side interpretation.** The icon a card wears, the date read from a letter, the assignee suggested: decided on the server so two phones, the web and a co-parent agree, and so old data can be filled in once.
- **Failure is visible.** Health endpoints name the cause; an hourly watch emails on any unhandled error; AI model retirement is detected rather than silently degraded.

## 3. The AI component, honestly

Ahenora does not train models. It orchestrates a general model: a fixed prompt per feature, a closed output schema, a validator that refuses anything outside it, a human review step before anything is saved, a monthly quota per household, and a health check that notices when the provider changes. The novelty claimed is the orchestration layer: input → interpretation → action → assignment → reminder → shared household state, across four languages and several adults. See `AI_PROCESSING_MAP.md` for every route and every control.

## 4. Technical uncertainties the funded programme would resolve

These are the questions we cannot answer from the current product, phrased so that an experiment can settle them.

| Uncertainty | Why it is uncertain today | How the programme tests it | Measure |
| --- | --- | --- | --- |
| Can one interpretation layer route any household input to the right place? | Each source has its own prompt and validator; school and clinic documents vary by country and language | Build a single classifier over typed, spoken, scanned and imported inputs; run it on a pilot cohort's real inputs | Correction rate per input type and language |
| Do suggested assignments and reminders earn acceptance? | No data on whether a household accepts a machine's guess about who does what | Show suggestions to a pilot cohort, always overridable; log accept, change, dismiss | Acceptance rate; time-to-assign |
| Does a second adult activate and stay? | 92 registered households, 2 with two adults | Redesign invitation, joining and first shared value; instrument invite-to-join, time-to-second-adult, multi-adult retention | Second-adult activation rate; D30 retention solo vs shared |
| Can two homes share one state without leaks or duplicates? | Per-item privacy exists; two-home patterns (custody, hand-offs) are lightly used | Hand-off checklists and custody-aware views in co-parenting households | Duplicate and "wrongly visible" incidents per household-month |
| Does the product reduce coordination effort? | No baseline measured | Baseline and follow-up survey on coordination time, missed obligations, perceived load, in a pilot cohort | Change from baseline, reported as measured, not claimed |
| What model size is accurate enough at a cost per household that works? | Scans are metered; accuracy versus cost untested | Evaluate smaller and cheaper models on the same validated inputs | Accuracy per cost |

## 5. Development roadmap for the programme (12 to 18 months)

| Quarter | Work package | Output |
| --- | --- | --- |
| Q1 | WP1 Household activation | Guided invitation flow, second-adult onboarding, instrumented funnel |
| Q1–Q2 | WP2 Intelligent coordination | One interpretation layer; assignment and reminder suggestions with acceptance logging |
| Q2 | WP4 Privacy and safeguards | DPIA, external security review, data map kept in the repository |
| Q2–Q3 | WP3 Co-parenting workflows | Two-home hand-offs, custody-aware calendar, named sharing on every object |
| Q3 | WP5 Impact experimentation | Pilot cohort, baseline and follow-up survey, cohort tables from `/api/metrics/grant-evidence` |
| Q3–Q4 | WP6 Market validation | Interviews, pricing tests, partnership pilots |

## 6. Evidence the repository can produce on demand

- `GET /api/metrics/grant-evidence` (admin): every KPI with its definition and window, as JSON or CSV, including the second-member activation ladder (sent, opened, accepted, joined, onboarded, first action, multi-user, retained at 7 and 30 days).
- `docs/runbooks/restore-drill.md`: dated proof that backups restore.
- GitHub Actions history: every deploy, every test run, every smoke test.
- `docs/grant/`: this appendix, the data-flow map, the AI processing map, the security baseline and the child and teen permissions, regenerated from the code.
