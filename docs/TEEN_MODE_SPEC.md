# Teen Mode — Build-Ready Spec

_Status: concept / pre-build · Post-launch initiative · Owner: product_
_Companion mockup: teen phone + parent phone + integration diagram + graduation onboarding (see the interactive concept artifact)._

Related tasks: **#17** (design teen mode), **#18** (subscription/pricing review).

---

## 1. Vision & positioning

Today the app treats children as **profiles a parent manages** (stars, PINs, rewards) — perfect for a 6-year-old. But an adolescent isn't a profile: **they own a phone.** Teen mode turns the child into a **participating household member with their own login and their own lens.**

**North star:** _"the family app teens don't delete."_

**The one rule everything follows — participation, not surveillance:**

> The same money, plans and check-ins shown to a teenager as **independence**, and to a parent as **peace of mind** — with no duplicate entry and no tracking.

Why it matters strategically:
- **Customer lifetime.** A family on sticker-charts churns when the child turns 11. If the app grows up with the child (stickers → allowance → logistics → life skills), you retain that family for 10+ years.
- **Completes the promise.** The tagline is "your whole family, all in one place." Teens are the missing third.

**Explicit anti-goal:** this is **not** a monitoring/tracking tool (Life360, Bark). The moment it feels like surveillance, the teen uninstalls it and the feature dies.

---

## 2. Personas

| | Teen (e.g. Ama, 15) | Parent (e.g. Jordan) |
|---|---|---|
| Device | Own phone, own login | Own phone, own login |
| Opens it for | **Money + autonomy** (allowance, goals, control of own schedule) | **Coordination + reassurance** (who's where, pickups, approvals) |
| Hates | Being watched / nagged / treated like a little kid | Chasing, worrying, "can I have money?" friction |
| Retention driver | Their money and their day | Peace of mind without spying |

The dual-value test every feature must pass: **does the teen open it for themselves, AND does the parent get peace of mind without spying?** If only one side wins, cut it.

---

## 3. Core design principles

1. **Two lenses, one system.** Parent and teen see the *same* shared object (an allowance, a check-in, a pickup) from their own angle. Created once; nobody re-enters anything.
2. **The trust model is the product.** The teen **always sees exactly what the parent can see.** Sharing is opt-in and visible. No hidden anything.
3. **Adult UI for teens.** No stars/stickers. Money, autonomy, and a "trust track record." Treat them like the young adults they want to be.
4. **Low friction.** One-tap status, one-tap approve, one-tap check-off.
5. **The "3 things on open" test.** Teen: _my money · what's next · anything asked of me._ Parent: _everyone's day · who needs a ride · approvals waiting._

---

## 4. Feature set (v1 scope)

| Area | Teen experience | Parent experience |
|---|---|---|
| **Identity** | Own login; a "teen" role in the household | Invites teen; sets teen permissions |
| **Money (virtual ledger)** | Balance, allowance, saving goals, "ask for money" | Approve requests, see balances, set allowance/chore values |
| **Status check-ins** | One tap: "on my way / home safe / running late" | Receives the check-in the teen *chose* to send — no GPS |
| **Plans & rides** | Own events; ride/pickup confirm | Sees teen's day; who needs a pickup |
| **Responsibilities** | "Agreed" tasks that can earn money | Assign & track (existing task system) |
| **Life skills** | "Owns a dinner night" (recipe + shopping) | Offloads a meal; builds capability |

---

## 5. The money model — READ THIS (regulatory boundary)

**v1 is a VIRTUAL LEDGER, not a payment product.**

- The allowance/balance/goals are **numbers in our database.** No real funds are held or moved by the app.
- Real money changes hands **outside the app**, as the family already does it (cash, existing transfer, card top-up).
- "Ask for money" and "Approve" record an **agreement/IOU**, not a transaction.

**Why:** moving real money (linked bank accounts, held funds, transfers) makes us a **regulated financial service** — PSD2/e-money licensing, KYC/AML, fund safeguarding, and heightened rules for minors. That is a licensed-fintech business (GoHenry/Greenlight), not a feature.

**Future (out of scope, strategic):** real money would be delivered via a **Banking-as-a-Service partner** who holds the licence (e.g. Swan, Treezor — both FR). Do **not** attempt in-house. Keep entirely out of v1.

**Hard rule:** no bank-account linking, no card issuance, no real-money transfer in teen mode v1.

---

## 6. Architecture — how it plugs into the existing app

Teen mode is a **second lens on engines that already ship**, not a second app.

| Teen-mode piece | Existing system it reuses |
|---|---|
| Teen with own login | Household **members + invites + roles** |
| Responsibilities | **Tasks / cards** (the "Handed to you" Feed list) |
| Allowance & goals | **Pocket-money** feature (extend with goals + request→approve) |
| Events & rides | **Shared Calendar** (already multi-member) |
| Life skills | **Kitchen** module |
| Younger kids' stars/rewards | **Unchanged** — littles keep the sticker world |

**Parent side = additive only.** New card types flow into existing surfaces:
- Feed → "Ama is home safe" status card + "Ama asked for €15 · Approve" card
- Kids → a kid with an account shows money/status + "Give Ama her own access" button
- Calendar → teen's shared events appear

**The only genuinely NEW build:**
1. **Role-based lens switch** — on login, render the teen shell (Home · Money · Plans · Family) vs the parent shell (Feed · Calendar · + · Kids · Kitchen). Same binary, one role decides the shell.
2. **Teen-role permissions + sharing settings** (the consent object).
3. **Teen-data consent layer** (compliance).
4. Extensions to pocket-money: **saving goals** + **request→approve** flow.

Everything else is reuse + additive cards.

---

## 7. Onboarding — the "graduation" flow

Lives inside the existing **Kids** tab; reuses the existing **invite** flow. Three steps:

1. **Parent invites** — from a child profile: "Ama's ready for her own space" → *Send Ama an invite* (link/QR/email). Note: "Free to set up · you approve what she can do."
2. **Teen sets up** — warm, grown-up welcome ("Your own space, Ama") → *Continue with Google / Use email*.
3. **Teen picks what's shared** — consent toggles, with **"exact location" defaulted OFF** and labelled "stays your choice." This screen is simultaneously the trust promise and the minor-consent compliance step.

Sharing settings (defaults):
| Setting | Default | Notes |
|---|---|---|
| Calendar & plans | On | so pickups line up |
| "Home safe" check-ins | On | teen-initiated only |
| Allowance & goals | On | shared with whoever funds it |
| Exact location | **Off** | never on by default; teen-controlled |

---

## 8. Data model sketch (v1)

- **Member.role** — add `teen` alongside existing parent/member roles.
- **SharingSettings** (per teen) — booleans: `calendar`, `checkins`, `allowance`, `location(false)`; teen-editable, parent-visible.
- **AllowanceLedger** — entries `{ memberId, amount, reason, type: allowance|chore|bonus|adjustment, createdBy, createdAt }`; balance = sum. Virtual only.
- **SavingGoal** — `{ memberId, title, target, saved }`.
- **MoneyRequest** — `{ memberId, amount, note, status: pending|approved|declined, decidedBy }`. Approval = ledger note, **not** a transfer.
- **StatusCheckin** — `{ memberId, kind: onway|homesafe|late, at }`; teen-initiated, surfaced to permitted members.
- Responsibilities/events reuse existing **card** + **calendar** entities, assigned to the teen.

---

## 9. UI

- **Teen shell tabs:** Home · Money · Plans · Family (adult styling; no gamified stars).
- **Teen Home ("3 things on open"):** money card (hero) → today (events/rides) → one-tap status → agreed tasks.
- **Parent:** unchanged shell + additive teen-aware cards (status banner, money-request approval, teen's day, allowance summary).
- Reference the concept mockup for visual language (matches the app's warm-orange/cream system).

---

## 10. Compliance & safety (design-in from day one)

- **EU/UK Age-Appropriate Design Code + GDPR-K** apply (FR-based, minors as users): data minimisation, age-appropriate defaults, clear consent.
- **Google Play Families policy** — review target-audience & content settings when teens are users.
- **Minor consent** — the step-3 sharing screen is the consent surface; parent is account/consent authority as required by age.
- **No purchases in the teen flow** — the parent is always the payer (see §11).
- **Location off by default**, always teen-controllable. Never introduce passive/background tracking — it changes the product into a surveillance tool.

---

## 11. Monetization (see task #18)

Household COO Premium already exists and already includes pocket-money (`frontend/app/pricing.tsx`). **Current price anchor: €6.99/mo or €49.99/yr.** Teen mode is "pocket money, grown up" — it slots into the paid tier naturally.

| Model | Upside | Downside |
|---|---|---|
| **A. Fold into existing Premium** | Simplest; strong upgrade reason; no new billing | Leaves some money on table |
| **B. New "Family+" tier** | Captures higher willingness-to-pay | New Play Console tier + lineup complexity |
| **C. Per-teen add-on** | Scales with family size | Friction; feels nickel-and-dime |
| **D. Freemium teen** | Free teen join = viral; money = paywall | Needs careful free/paid line |

**Recommendation:** **A + a dash of D, at €0 extra for v1.** A teen can *join* free (drives adoption + network effect), but the **allowance/money engine is Premium** (the existing €6.99/mo · €49.99/yr). The teen gets hooked; the parent hits the paywall exactly where value is highest. Use teen mode as the **headline upgrade driver** — it lifts conversion + retention (teen families churn less), which is worth more than a small add-on fee at this stage.

**If/when a paid uplift is justified by data** → a **Family+** tier at **~€8.99/mo or ~€69–79/yr** (roughly +€2–3/mo over base). Rationale for the ceiling: real-money kids' cards (GoHenry/Greenlight) run ~£4–8/mo *per child*, but they're licensed fintechs moving real money — we're a **virtual tracker**, so price **below** them and **never per-child** (per-teen add-ons create friction). Family organisers (Cozi et al.) sit ~$30–40/yr, so a Family+ at €69–79/yr sits sensibly between our base and fintech.

Review must cover: Play Console subscription products, **grandfathering** existing subscribers, free-vs-Premium line, parent-as-payer compliance.

---

## 12. Phased roadmap

| Phase | Ships | Mostly reuse / new |
|---|---|---|
| **1 — Prove peace-of-mind** | Teen account + own login + shared calendar + one-tap status/ETA | Reuse members/invites/calendar; **new:** role shell + status card |
| **2 — The daily hook** | Allowance ledger + saving goals + money requests (virtual) | Extend pocket-money; **new:** goals + request/approve |
| **3 — Deepen** | Ride coordination + responsibilities-as-agreements + Kitchen "owns a night" | Mostly reuse |
| **4 — Independence** | Further life-skills / trust scaffolding | New, incremental |

---

## 13. Validation before build (do first)

Interview **5–10 parents of teens + a few teens.** The five questions that de-risk the bet:
1. Parents: what do you actually worry about day-to-day with your teen? (listen for logistics vs safety)
2. Teens: what would make you *keep* a family app on your phone? (listen for money/autonomy)
3. Both: where's the line between "helpful coordination" and "spying"?
4. Parents: would you pay for a teen allowance/logistics tool? How much?
5. Teens: would you use one-tap "home safe" instead of your parent texting "where are you"?

Kill criterion: if teens uniformly read it as surveillance, stop and re-scope.

---

## 14. Open decisions

- Minimum teen age (11? 13?) and the consent/authority model per age band.
- Monetization model final call (§11 / task #18).
- Whether "rides/pickups" is a calendar item type or a distinct object.
- Name/branding of the teen tabs (pending the app-name decision).

---

## 15. Risks

- **Surveillance perception → teen uninstalls → feature dies.** Mitigate with the trust model + location-off default.
- **Scope creep into real-money/fintech.** Mitigate with the §5 hard boundary.
- **Minor-data compliance.** Mitigate by designing consent/minimisation in from Phase 1.
- **Pricing confusion.** Mitigate by starting simple (fold into Premium) not a new tier.
