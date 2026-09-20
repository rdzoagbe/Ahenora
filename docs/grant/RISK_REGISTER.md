# Risk register

_For the grant dossier (checklist section 12). The technical, AI, privacy, platform-dependency and delivery rows are written from the code and the operating history as of 20 September 2026. The adoption, financing and execution rows are the founder's to complete; they are drafted here so the table is whole, and marked **[FOUNDER]** where a judgement or a number must come from him._

Likelihood and impact are rated Low / Medium / High. "Owner" is who acts, not who worries.

## Adoption

| # | Risk | L | I | Mitigation in place | Planned in the programme | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | The second adult never joins: households stay solo and the collaboration proposition is unproven (2 of 92 households have two adults) | H | H | Invitation by email or link, five acceptance routes hardened against content blockers, invite discovery on sign-in, funnel and ladder measured (`/api/metrics/grant-evidence`) | WP1: guided invitation flow, second-adult onboarding, first shared value on joining; the ladder as the primary KPI | Founder + engineering |
| A2 | Registered households do not activate | M | H | Onboarding seeds a first success; 24/24 recent completions | Interviews with inactive households; activation experiments | Founder |
| A3 | Willingness to pay does not hold beyond the first three households | M | M | Real purchases on both stores and the web; billing reconciles itself against RevenueCat | WP6: pricing tests, retention by plan | Founder **[FOUNDER: pricing hypothesis]** |
| A4 | The primary segment is wrong or too broad | M | M | Positioning around parents and co-parents with children | WP6: interviews, segment decision documented | Founder |

## Technical

| # | Risk | L | I | Mitigation in place | Planned | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | A change breaks the live app on two stores | M | H | 2,160 backend and 884 frontend tests, browser harnesses on the real build, CodeQL, native-dependency gate, runtime-version gate, smoke test on every deploy, one-action rollback of over-the-air updates | External code review budgeted | Engineering |
| T2 | Database outage or misconfiguration | L | H | Health check names the cause; hourly error watch; restore drill run and recorded (15 and 17 Sept 2026); least-privilege database user; continuous backups on a dedicated tier | Private endpoint or strict allow-list on Atlas **[FOUNDER: confirm]** | Founder |
| T3 | Interpretation layer misroutes household inputs across four languages and messy documents | H | M | Closed output schemas, validators, human review before saving, per-route prompts | WP2: single interpretation layer measured by correction rate (the core R&D uncertainty) | Engineering |
| T4 | Scale: unindexed queries and blocking work slow the service as households grow | L | M | 62 indexes with a guard test that fails on an unindexed query; password hashing, cropping and model discovery off the event loop; measured timings endpoint | Pool tuning before growth | Engineering |
| T5 | Over-the-air update reaches a phone whose native binary cannot run it | L | H | Runtime version gates updates to matching binaries; native changes only ship through store builds; a test refuses an OTA that adds a native module | — | Engineering |

## AI reliability

| # | Risk | L | I | Mitigation in place | Planned | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| AI1 | Provider retires a model or changes behaviour silently | M | M | Model fallback list, health check that reports the model actually answering, admin alert; this happened once and is why the check exists | Timeouts on provider calls | Engineering |
| AI2 | A wrong extraction becomes a wrong appointment or a wrong assignment | M | M | Validators refuse anything outside the schema; every AI result is a draft or a candidate a person confirms; an unparseable answer becomes a blank card, never a guess | WP2 measures correction rate; suggestions logged accept/change/dismiss | Engineering |
| AI3 | Prompt injection through a scanned document or typed text | M | M | Input screening for injection patterns and invisible characters; length caps; fixed system prompts; closed output schema | Adversarial test set in the programme | Engineering |
| AI4 | Provider cost per household exceeds plan revenue | M | M | Scans metered per household per month; counter increments only when the provider read something | Evaluate smaller models on the same validated inputs | Engineering + founder |
| AI5 | A recipe or meal suggestion is unsafe | L | H | Recipe validator with an unsafe-instruction check; AI safety checklist is a blocking gate for new features | — | Engineering |

## Privacy and security

| # | Risk | L | I | Mitigation in place | Planned | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Children's data, including health records a parent types, handled without a DPIA | M | H | Children have no account, no email, no login; PIN and passwords hashed; data map and child permissions written (`docs/grant/`) | DPIA screening with qualified advice (budgeted); update the record once done | Founder + adviser |
| P2 | A private item shown to the wrong household member | L | H | Per-item visibility enforced in the database read; role guards server-side; kid boundary tested end to end | External security review | Engineering |
| P3 | Credential or token leak | L | H | Secrets only in hosting and CI environment; secret scanning and CodeQL; fingerprints not values in health output; redaction in logs; session tokens hashed; secure store on device | — | Engineering |
| P4 | A processor's terms or location do not meet the dossier's claims | M | M | Processor list written with **[CONFIRM]** marks | Confirm regions and DPAs for Railway, Atlas, Resend, RevenueCat; confirm Gemini training terms **[FOUNDER]** | Founder |
| P5 | A person cannot exercise their rights easily | L | M | Self-service deletion (household or individual) and self-service data export in the app; privacy@ contact | — | Engineering |

## Dependency on third-party platforms

| # | Risk | L | I | Mitigation in place | Planned | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | App Store or Play policy change, rejection or delay | M | M | Both stores live; review demo account; over-the-air path for non-native changes; web app as a third surface | Keep native changes rare and batched | Founder + engineering |
| D2 | Expo or a native module abandoned or breaking on an SDK bump | M | M | Pinned versions; 37 native modules gated; store builds through CI | Budget an SDK upgrade per year | Engineering |
| D3 | Hosting or database provider incident | L | H | Health and smoke monitoring; backups proven by drill; database on a dedicated tier | Documented migration path **[FOUNDER: accept or plan]** | Founder |
| D4 | Push delivery (Expo, browser vendors) fails silently | M | L | Push health endpoint reports per-job delivery; receipts checked | — | Engineering |
| D5 | Billing platform (RevenueCat, Stripe) outage or webhook loss | L | M | Reconciliation against RevenueCat on demand; manual grants never auto-revoked; signature-verified webhooks | — | Engineering |

## Financing and execution **[FOUNDER]**

| # | Risk | L | I | Mitigation | Planned | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Grant not awarded or awarded at a lower rate | — | — | Scenarios A/B/C sized to the work; debt-free principle | **[FOUNDER]** | Founder |
| F2 | Company contribution not available when needed | — | — | **[FOUNDER]** | | Founder |
| F3 | Costs incurred before filing are ineligible | L | H | Nothing in the work packages started before submission | Start date fixed at filing | Founder |
| E1 | Single founder; key-person dependency | H | H | Everything is in the repository with runbooks; delivery is automated; documentation regenerated from code | Named external contractors in the budget **[FOUNDER]** | Founder |
| E2 | Scope creep: features instead of experiments | M | M | Work packages with measurable outcomes; the evidence export as the scoreboard | Quarterly review against the ladder and impact measures | Founder |
| E3 | StackLens activity competes for the founder's time | M | M | **[FOUNDER]** | | Founder |
