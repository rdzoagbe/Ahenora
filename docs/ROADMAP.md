# Household COO — Product Roadmap & Decisions

The single source of truth for what's decided, what's parked, and what comes next.

---

## Where we are — 🚀 LAUNCHED
Last updated: 30 July 2026.

- **Production release live on Google Play**: release **41 (1.0.0)**, released 29 July 20:13, 176 countries, package `com.householdcoo.app`. First **R8-minified** production build (smaller download, obfuscated), first with the Spark Portal splash + launcher icon in native resources, shipped through the repaired EAS → Play pipeline.
- **Real billing is on:** Google Play Billing via RevenueCat, verified end-to-end with a real purchase. Free (Village) + Premium tiers enforced. **First revenue recorded** (July 2026).
- **Expo SDK 57 / RN 0.86** shipped 28 July — device-verified on the Internal testing track (version 38) before promotion.
- **Store presence:** "Spark Portal" app icon, 30-second promo video (YouTube), framed EN screenshots, IARC rating, co-parenting-led ASO listing.
- App is feature-complete: value-tour onboarding + guided setup, full **EN/FR/ES/DE** localization (874 keys/locale, parity-checked), Google + Outlook calendar import, meal suggestions, kids' stars, vault, morning digest, usage metrics, edge-to-edge, in-app review prompt.
- **Delivery pipeline:** push to `main` → auto **OTA update** (JS changes; users need two full relaunches). Native changes → `EAS Build (Android)` workflow → AAB → auto-submit to the Play production track as a **draft**.
- **Infrastructure:** MongoDB Atlas **M10 dedicated with backups Active**; UptimeRobot on `/api/health` (accepts GET **and HEAD**).

### Live obligations — ✅ all clear
- [x] **Developer Profile — complete** (verified in Play Console 29 July). Developer icon, header image, featured app, developer website (`rdzoagbe.github.io/Ahenora/`) and promotional text all set. The 26 August removal warning no longer applies.
- [x] **United States tax — W-8BEN approved** (submitted 28 July, valid to 31 December 2029). France treaty claim accepted: **0% withholding** on all three rate categories (motion picture/TV, other copyright, services), with Certificate of Non-US Activities and Affidavit of Unchanged Status on file. The 30% withholding is gone.
- [x] Tax: France ✅ · Ireland ✅ · United States ✅.
- [x] **Payments — cleared** (verified 29 July). Bank account registered (FR IBAN ending 0147), no verification prompt outstanding. First earnings recorded: **€4.96** on 29 July, above the €1.00 payout threshold, so payouts run monthly from around the 15th.

### Shipped 30 July (one day, twelve merged PRs)
- **Recipes redesign (Phase 4 ①②, early by owner decision):** full-screen recipe pages with servings math (#282), AI recipes with validated quantified ingredients (#283), "Ask the chef" Q&A (#284) — all behind the AI-safety gate.
- **Photo capture:** paper shopping list → reviewed items (#288); printed recipe → structured recipe on the planner, re-validated on commit (#289).
- **Meal suggestions fixed for real:** server remembers what it proposed so every open gives a new week (#285); honest "planning your week…" state (#287).
- **Android sheet scrolling** — Touchable-wrapped scrollers froze every tall sheet; fixed at the component level plus a nested-scroller sweep (#281, #286).
- **Calendar sync mirrors reality:** rescheduled meetings move, renames follow, cancellations remove the card; both Google and Outlook (#293). Field-verified same day.
- **Billing self-heals:** `POST /api/billing/reconcile` checks RevenueCat directly (`REVENUECAT_SECRET_KEY` on Railway); a missed webhook can no longer strand a paying family; manual grants never auto-revoked (#293).
- **Faster AI where users wait:** chef answers + list scans lead with the lite model, quality jobs stay on the strong chain (#294).
- **Foundations:** FastAPI 0.110→0.141 + uvicorn 0.27→0.52 (#291); ten unused backend deps removed (#279); onboarding rewrite (#278); full-app audit → locale currency symbols + role-casing hardening (#290).
- Backend test suite 173; frontend 86; recipe library 50 dishes.

## Post-launch — what's left (master list, ordered)

### A. Stabilization — ✅ COMPLETE
- [x] **Database backups** — Atlas upgraded free M0 → **M10 dedicated, backups Active**.
- [x] **Uptime monitoring** — UptimeRobot on `/api/health`; endpoint accepts HEAD (#231).
- [x] **Expo SDK 54 → 57** — shipped (#236), device-verified before promotion.
- [x] **Play Data Safety form** — corrected and re-submitted; Google review passed.
- [x] **Play policy rejection (Photo/Video Permissions)** — broad media permissions removed from the committed manifest (#225); CI guard added so it cannot regress (#226).
- [ ] Watch **Play Console** crash-free rate, ANRs and reviews; fix real-user issues via OTA. *(ongoing, not a task that closes)*
- [ ] **Remaining Dependabot PRs** (#213 #215 #216 #217 #218) — merge the safe ones now that the SDK upgrade has landed.

### B. Small open promises (quick, mostly OTA)
- [x] **UI/UX consistency pass** — pricing cards theme-aware (#233), accessibility labels on icon-only buttons (#234), sub-44px tap targets enlarged + theme-blind borders fixed (#235).
- [x] **In-app review prompt** — asks after 5 real wins, once per install, degrades gracefully (#232).
- [x] **Public account-deletion page** — required by Play Data Safety; covers full and partial deletion (#229, #230).
- [x] **Security hardening** — identity lockout, `re.escape` on user-supplied regex, constant-time PIN compare, generic OAuth errors (#223, #228).
- [x] **Meal planner / shopping list translations** — untranslated strings swept.
- [x] **Kids "how stars work" + Vault "why upload"** first-use explainers — `FirstRunTip` on both tabs.
- [x] **Allergen/safety note** on the meal planner — in the Cook sheet, and now in the suggestions sheet too, because "Add all to planner" commits a week without opening a single dish. **AI-safety checklist** written as a blocking gate: `docs/AI_SAFETY_CHECKLIST.md`.
- [x] **Meal suggestions stored by recipe-id** so they re-translate on language switch.
- [x] **Landing page** — `docs/index.html` live on GitHub Pages.
- [ ] **Every-4-days audit email** (blocked on the Gmail connector; posts in chat until then).
- [x] `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` removal — `tools:node="remove"` in the manifest; ships with v40.

### C. Your-side (non-code)
- [ ] **DMARC record** on the sending domain `joblytics-ai.com` (Squarespace DNS): TXT, host `_dmarc`, value `v=DMARC1; p=none; rua=mailto:<you>@joblytics-ai.com`. Resend already sets SPF+DKIM; DMARC lifts inbox placement so invite emails don't land in spam.
- [ ] **Prince** — friendly credit/consent conversation for the onboarding ideas.
- [ ] **Tell testers/users** about Settings → Replay setup.

### D. Feature phases (recommended order) — see detail below
- [ ] **Phase 2 — Web version** (biggest reach: iPhone + desktop via browser, no Apple/$99).
- [ ] **Phase 2c — Sign in with Microsoft** (small follow-on; account-linking care = post-launch).
- [ ] **Phase 3 — Platform polish** (widget, tablet/landscape, crash-report mapping).
- [ ] **Phase 4 — AI food & gifting** (recipe steps → AI Chef fridge scan → Gift Concierge).
- [ ] **Phase 5 — Family Ops Suite** (Kid Health Card + Caregiver Mode flagship, then the rest).
- [ ] **Native iOS app** — only when revenue justifies the $99/yr (no Mac; EAS builds it in the cloud).

### E. Parked (only if users ask) — see bottom

> **Email sending — status & notes.** Invites send via Resend from a from-address on the **verified** domain `joblytics-ai.com` (`INVITE_FROM_EMAIL`). Two bugs fixed during closed testing: a stray trailing space in the `GOOGLE_API_KEY` Railway variable name (broke AI features), and a missing `User-Agent` header on the Resend request (`403 error 1010`, blocked all sends). Email template is light/transactional with `List-Unsubscribe` headers. Remaining: DMARC (above) + reputation warm-up. Polish: move sending to a **matching** domain (`householdcoo.app`) so the sender brand matches the app.

## Pricing & gating (decided)

**Two tiers at launch: Free + Premium.** Keep it simple — a third
"Family Office" tier is deferred until big/extended households actually ask
for it (three similar tiers depress early conversion). Both parents always free;
the cleanest paywall is **household size (child count)** — non-punitive, nobody
resents metering on how many kids they have.

| Tier | Price | Household |
|------|-------|-----------|
| **Free** | $0 | both parents + up to 2 children |
| **Premium** | **$6.99/mo · $49.99/yr** | both parents + up to 5 children (+ caregivers) |

*(Family Office — extended households of ~10 kids + caregivers, bigger storage/AI —
kept in the back pocket for later, not launched.)*

### Feature map
- **Free (the daily-habit hook — keep genuinely useful):** feed, tasks, calendar,
  **all retention nudges** (streak, co-parent pings, dinner + Sunday recap), kids
  stars/rewards/chores/celebrations, shopping list **+ reuse past lists**,
  **viewing any document** (PDF/Word/Excel), sharing, ~25 MB vault, 5 AI scans/mo, up to 2 children.
- **Premium ($6.99):** up to 5 children, **meal planner + saved plans**, **pocket
  money/allowance**, **weekly report**, **carpool**, 100 AI scans/mo, 500 MB vault.
  Later: **AI Chef**.

### Principles
- **Never paywall the retention loop** (streak, co-parent pings, dinner/Sunday
  nudges) — those feed the funnel; gating them starves conversion.
- **Document *viewing* stays free**; monetize **storage** instead (vault fills up →
  upgrade). Charging to open a doc you saved feels punitive.
- **Meter on child count generously (2 free)** so modest families rarely pay "just for a kid"; **lead every upgrade prompt with the feature** ("Unlock meal planning & pocket money"), never the child limit — avoids a "child tax" feel for a parenting brand.
- **Push the annual plan** — that's where family apps make their money. Prices can
  rise later; lowering is painful, so we start at $6.99 and grow into more.

### Status & mechanics
Display-only today. **Testing window:** the Free member cap is temporarily relaxed
to 10 so closed-test families can explore multi-kid features (no upgrade path exists
yet). **Enforcement** (parents uncounted, children metered 2 free / 5 Premium) ships
with **Phase 1 billing** — rebuild `PricingView` to two tiers, collapse
`PLAN_CATALOG`, set prices in Play Console. Google Play Billing handles currency
localization, tax, and payouts (15% fee) — **no Stripe** for in-app subscriptions (Play policy).

---

## Post-approval execution plan

Ordered by what to do first. Each item notes **how** we build it and whether it
ships via **OTA** (JS only) or needs a **native build** (EAS Build → AAB).

### Step 0 — Launch stabilization (first ~1–2 weeks) — IN PROGRESS
Before building anything new, watch the wider audience. (See the "Post-launch — what's left · A" checklist at the top.)
- Production launched at **full rollout** (first release, no existing users to protect — acceptable).
- Watch **Play Console** crash-free rate + ANRs, reviews, and **Settings → Usage analytics**.
- Fix whatever real users surface via OTA.
- Feature freeze lifts → batch the held **Dependabot** updates one small, verified PR at a time.
- **Confirm DB backups** before anything else.

### Phase 1 — Monetization (Google Play Billing) — ✅ SHIPPED & LIVE
Real billing is live in production (`RC_WEBHOOK_SECRET` set, verified with a real purchase). Historical detail retained below.
**CODE COMPLETE** — shipped ahead of store setup; everything is inert until the keys exist:
- ✅ `PLAN_CATALOG` collapsed to **2 tiers** ($6.99/$49.99); role-aware child metering (**parents never counted; children 2 free / 5 Premium**); legacy `family_office` resolves to executive.
- ✅ **RevenueCat webhook** `POST /api/billing/revenuecat-webhook` (auth: `RC_WEBHOOK_SECRET`) = single source of truth for the family plan. CANCELLATION keeps access until EXPIRATION. Self-serve `/subscription/change` **auto-locks for non-admins** the moment `RC_WEBHOOK_SECRET` is set.
- ✅ `react-native-purchases` installed (native → needs the next AAB); `src/billing.ts` no-ops gracefully on builds without it (OTA-safe).
- ✅ PricingView: real purchase + **Restore purchases** flows (fallback alert until billing build); downgrade points to Play subscriptions.
- ✅ Conversion: **free peek at meal suggestions** — locked families see the 7 dinners; "Add" prompts the upgrade.

**Store setup — done 2026-07-19:**
- ✅ RevenueCat project + Play app (`Household COO (Play Store)`, package `com.householdcoo.app`).
- ✅ Google Cloud service account `revenuecat@household-coo-cd91e.iam.gserviceaccount.com` (project Household-Coo), JSON key uploaded to RevenueCat, invited in Play Console (view app info + financial data + manage orders), **Google Play Android Developer API** enabled.
- ⏳ RC shows "credentials need attention" — normal propagation (up to ~36 h) + clears fully once products exist. Skipped: Google developer notifications (webhook covers us), custom URL scheme, financial reports bucket.

**Billing FULLY STAGED — completed 2026-07-19 (Option B):**
- ✅ Billing AAB built (`eas-build.yml` production, run 29692170322) with `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` baked into `eas.json` (public `goog_` key — safe in repo); uploaded to the closed testing track.
- ✅ Play subscription: **ONE subscription `premium_monthly`** (display name "Premium") holding BOTH base plans — Google's recommended model. `monthly` ($6.99, grace 7d) + `yearly` ($49.99, grace 14d), both **Active**, prices applied to all countries via suggestions with manual overrides **France/EUR 6,99 €/49,99 €** and **US $6.99/$49.99** (sticker-price-first: customer sees the marketing number, VAT comes out of it). NOTE: there is NO separate `premium_yearly` Play product — RevenueCat product ids are `premium_monthly:monthly` and `premium_monthly:yearly`.
- ✅ RevenueCat: Test Store dummies deleted; entitlement **`premium`** ↔ both Play products; `default` offering: `$rc_monthly` → `premium_monthly:monthly`, `$rc_annual` → `premium_monthly:yearly` (monthly set as backwards-compat fallback — never used, SDK is v10); lifetime package removed.

**THE ONE REMAINING SWITCH (launch day, deliberate):**
1. Invent a long random secret → RevenueCat webhook config (`https://household-coo-production.up.railway.app/api/billing/revenuecat-webhook`, Authorization header) **and** Railway `RC_WEBHOOK_SECRET` (same value). This single act: enables real plan sync, ends testers' free-Premium window + preview banners, and locks `/subscription/change`.
2. Verify end-to-end: sandbox purchase with a license tester (Play Console → Settings → License testing) → RC dashboard shows the purchase → webhook flips family plan to executive → app unlocks Premium.
- ⚠️ Never set the Railway secret casually — it is the launch switch.

### Phase 2 — Web version (iPhone family access) *— free iPhone reach, NO Apple, NO $99, NO Mac*
> **Why this before native iOS:** the web build lets iPhone AND desktop users open the app in a browser (e.g. `app.householdcoo.app`) with zero Apple involvement — no App Store, no $99/yr developer program, no Mac. iPhone users can "Add to Home Screen" for an app-like full-screen icon. Trade-offs (the actual build work): it's a **companion, not a native app** — not searchable in the App Store (share the link), iOS Safari push notifications are limited, and camera/scan/file-share need web fallbacks. Covers ~90% of what an iPhone parent needs (tasks/calendar/lists), so it solves the co-parent-on-iPhone gap cheaply. Native iOS stays deferred until revenue justifies it.
- `expo export --platform web` → free static hosting (Vercel/Netlify/GitHub Pages).
- Work is **guarding native-only modules** for web (document-picker, sharing, intent-launcher, PDF/WebView) with web fallbacks.
- Add the **web origin** to Google OAuth allowed origins + backend `ALLOWED_ORIGINS` (CORS).
- Positioning: companion access for iPhone family members — not a full iOS app (that's the $99/yr Apple program, later, when revenue justifies).

**Native iOS app (later, when revenue justifies — NO Mac required):**
- Build/ship entirely from the cloud: **EAS Build compiles iOS on Expo's macOS servers** (`eas build --platform ios`), `eas submit --platform ios` uploads to App Store Connect, listing/review done in-browser. EAS generates + manages signing certs/provisioning profiles in the cloud (the thing that used to need a Mac). Same pipeline as our Android AAB.
- Cost: **Apple Developer Program $99/yr (recurring**, vs Google's one-time $25).
- iOS-specific work (code/config, not hardware), required before it'll pass review:
  - **Sign in with Apple** — Apple mandates it as an option whenever a third-party login is offered, and we use Google Sign-In. Must add.
  - **Apple IAP** — purchases must use StoreKit, not Play Billing. RevenueCat abstracts both, but set up products a 2nd time in App Store Connect + an iOS RC app.
  - **In-app account deletion** button (accounts exist → App Store guideline).
  - Verify native modules are iOS-compatible; review is slower/pickier than Google.

### Phase 2b — Outlook / Microsoft calendar import (meet families where they are)
Many parents live in work-Outlook, and co-parents are often split (one Google, one Microsoft). The Calendar "Sync" becomes **"Import calendar"** with a provider dropdown: **Google · Outlook · Both**.
- **Backend: DONE** — `POST /api/calendar/import-microsoft` (Microsoft Graph `/me/calendarView`, mirror of the Google import; dedup by `ms_event_id`, `external_source: "microsoft_calendar"`, private-by-default). Takes a delegated token from the app — no secret server-side.
- **Frontend (to build):** Microsoft sign-in via **`expo-auth-session`** (already in the build → OTA-safe, no new native module), PKCE public-client flow, scopes `Calendars.Read offline_access openid profile email User.Read`; provider dropdown; "Both" runs both flows.
- **Azure app registration (Household COO, client ID `d9a47680-…`) — user action needed:**
  1. **Supported account types → "any org directory + personal Microsoft accounts"** (currently "Multiple organizations" = work/school only → would exclude outlook.com/hotmail family users). **Blocker.**
  2. Add a **mobile/public-client redirect URI** (Authentication → Add platform → Mobile) — exact value TBD from the Expo scheme.
  3. **API permissions → Microsoft Graph → Calendars.Read** (delegated) + offline_access/openid/profile/email.
  4. **No certificate / client secret** — mobile is a public client (PKCE). Leave Certificates & secrets empty.
  5. Multi-tenant + personal accounts may need **publisher verification (MPN ID)** to avoid consent friction.

### Phase 2c — "Sign in with Microsoft" (post-launch auth enhancement)
Natural follow-on to Outlook import, but a **separate concern**: import gets a *calendar access token*; sign-in needs an *identity token* + account creation. Import already works for Google/email users **without** this, so it's a convenience, not a gap.
- **Mostly reuse** — the Azure app + `expo-auth-session` plumbing exist, and we already request `openid`/`email` scopes. Frontend is ~80% there.
- **Backend (the real work):** verify the Microsoft ID token (issuer/audience/JWKS, mirror the Google ID-token path) → find-or-create user.
- **The wrinkle — account linking:** dedup by email so a parent who signed up with Google and later uses "Sign in with Microsoft" (or a different email) doesn't create a duplicate account/family. This is why it's **post-launch, not pre-launch** — auth changes lock people out if rushed.
- Do it once Google + email conversion data is in and the app is stable; ship with careful identity testing.

### Phase 3 — Platform polish (ranking + engagement)
- ✅ **Edge-to-edge / full-screen — DONE (shipped in launch AAB):** `edgeToEdgeEnabled: true`; safe-area audit completed across all tabs + sheets (offline banner, tab-bar clearance, localized). Live.
- **Android home-screen widget** (today's tasks) — native build. `react-native-android-widget` or a small native module + config plugin.
- **Tablet / landscape** — unlock the portrait lock in `app.json`; lean on existing `useBreakpoint` responsive layouts; polish large screens (Play ranking factor). Native build for the orientation change.
- **Crash-report mapping** — upload deobfuscation `mapping.txt` (or add Sentry) so production crashes are readable.

### Phase 4 — AI food & gifting (Executive-tier differentiators)
- [x] **Cooking steps per meal — DELIVERED 30 July, beyond spec** (structured recipes with quantities + servings scaling for curated, AI-written and photographed recipes; "Ask the chef" substitutions). Remaining from the original idea: dinner-reminder deep-link to tonight's recipe.
- **Cooking steps per meal (original notes):** each suggested meal gets a short, parent-friendly recipe — step-by-step instructions + timings — so choosing a dinner also tells you *how to cook it*. Build path: ① add a `steps` field to the `mealSuggestions.ts` library (localized like titles, OTA-friendly, works offline) for the 38 curated meals, shown in a "Cook it" view from the planner/suggestion sheet; ② later, Gemini generates steps for *any* custom meal a parent typed themselves (needs API budget → Premium AI Chef umbrella). Dinner-reminder tie-in: the 17:30 nudge can deep-link straight to tonight's recipe.
- **AI Chef (fridge scan):** *(first half exists: the shopping-list photo scan shipped 30 July shares the pipeline — fridge photo → missing items remains.)* photograph groceries → reuse the **Gemini vision pipeline** (same as document scan), new prompt → one-tap add missing items to the shopping list. Lives in the **Kitchen tab**. Mostly a new prompt + UI (OTA-friendly).
- **AI Gift Concierge:** ① birthday field on members → "birthday in 3 days" **feed card** (also retention idea #5), ② Gemini gift suggestions with budget, ③ birthday message + notification, ④ retailer **affiliate link-outs** for revenue (no gift-card *issuance* — payments regulation).

### Phase 5 — Family Operations Suite (deep-value differentiators for busy/large families)
Post-launch bets that make the app the thing a parent reaches for in a real moment — not on any earlier phase. Ordered by value.
- **Kid Health Card + Caregiver Mode (flagship, do first in this phase):** a structured, per-child health record — allergies, meds + doses, blood type, pediatrician/dentist, vaccination dates, sizes, emergency contacts — pullable in an ER or handed to a grandparent. Pairs with a shareable, temporary **read-only "Caregiver Mode"** screen for a babysitter/grandparent: allergies, meds, emergency contacts, bedtime routines, house rules, wifi, tonight's dinner, who to call. Stacks on the Vault + the existing co-parent sharing model. Strong **Premium** feature; genuinely absent from competitors. Backend: per-child health docs + a scoped share token (like the invite-link tokens). Mostly OTA (forms + a share sheet).
- **"Out the door" morning checklist:** per-kid, per-day launch list (water bottle, signed slip, gym kit, homework, library book Tuesdays) that **resets every morning**. Different shape from event-based cards — recurring daily items. OTA-friendly.
- **"Who has the kids / who's on duty" schedule:** first-class parenting-time / on-duty schedule ("Dad this weekend, Mom next"; "who's on pickup/bedtime tonight"). Big for the separated co-parents we now serve well, useful for together-parents too. Could be a real category differentiator vs generic family apps.
- **Sibling turn-rotation:** small, cheap, delightful — whose turn for front seat, dinner pick, movie choice. Defuses daily "it's not fair!" fights. Low effort, high charm.
- **Contacts hub** (folds into Caregiver Mode): pediatrician, dentist, school, other parents, babysitters, emergency — one place, shareable.

### Parked (only if users ask)
- **Kid logins** (children checking off their own chores) — flips Play audience to mixed → Families-program compliance. Revisit only on demand.
- **Tech debt at real scale (~1k users):** vault files base64-in-Mongo → object storage; split the 3,700-line `server.py`; Mongo indexes on `family_id`; PBKDF2 iteration bump.
- ~~**Migrate `google-generativeai` → `google.genai`**~~ — **done.** The old SDK was end-of-life; moved before it broke rather than after. Model discovery, the retirement-fallback chain and `GEMINI_MODEL` all carried over, and generation now uses the SDK's native async surface instead of a worker thread. `/api/health/ai` reports `sdk` and `client_ready` so the swap is visible in production.

### How we execute
- Same rhythm as the build-out: small branch → `tsc`/`jest`/`py_compile` → PR → merge → **OTA** for JS, **EAS build** for anything native.
- **New for production:** staged rollouts; watch crash-free rate; always flag build-vs-OTA before shipping.
- **Recommended sequence:** Stabilize → **Billing** (done) → **Web** → **Polish** → **AI** → **Family Ops Suite**.

---

## Operating rules (learned the hard way)

- **Nothing breaks during a live test.** Feature freezes are real; OTA only ships fixes/polish.
- JS fixes ship via OTA on merge to `main`; testers need **two full app relaunches** to receive them.
- The backend URL is guarded at runtime against the retired `-backend-` Railway subdomain; the canonical URL is `https://household-coo-production.up.railway.app` (keep GitHub secrets + EAS env in sync).
- Localized copy must fit: FR/DE run ~25% longer than EN — tight UI uses short translations + `adjustsFontSizeToFit`.
- Testers only count when they're added by Gmail in Play Console **and** tap "Become a tester". Quality of engagement matters to Google — never buy testers.
- Usage metrics are first-party, count-only (`/api/metrics/summary`, admin-only). Check DAU + feature counts mid-test to guide decisions.

---

## Release notes — build "Kitchen, retention & readable docs"

Paste the matching `<lang-CODE>` blocks into Play Console → release notes.
Use only the language tags your store listing supports, and make the code
match exactly (e.g. `en-US` vs `en-GB`). Each block is under Play's 500-char
limit. Update this section for each new build.

**Release name:** `1.0.0 – Kitchen & retention`

```
<en-GB>
What's new:
• New Kitchen tab — shopping list + meal planner together, with a quick switcher
• Open and read your PDF documents right from the Vault
• Documents now shown in a tidy, space-saving list
• Tap the bell to see exactly what needs your attention
• Stay on track: a daily streak, a dinner-time reminder and a Sunday recap
• Get a heads-up when your co-parent leaves a note or posts an announcement
• Smoother, clearer and more polished throughout
</en-GB>
<fr-FR>
Nouveautés :
• Nouvel onglet Cuisine — liste de courses et menus au même endroit
• Ouvrez et lisez vos documents PDF directement dans le coffre
• Les documents s'affichent en liste, plus compacte
• Touchez la cloche pour voir ce qui demande votre attention
• Gardez le rythme : série quotidienne, rappel du dîner et bilan du dimanche
• Soyez prévenu quand votre co-parent laisse une note ou une annonce
• Plus fluide, plus clair et plus soigné partout
</fr-FR>
<es-ES>
Novedades:
• Nueva pestaña Cocina: lista de la compra y menús juntos
• Abre y lee tus documentos PDF desde el baúl
• Los documentos ahora en una lista más compacta
• Toca la campana para ver qué necesita tu atención
• Mantén el ritmo: racha diaria, recordatorio de la cena y resumen del domingo
• Recibe aviso cuando tu co-madre/padre deja una nota o un anuncio
• Más fluido, claro y pulido en general
</es-ES>
<de-DE>
Neu:
• Neuer Küche-Tab — Einkaufsliste und Essensplaner an einem Ort
• PDF-Dokumente direkt im Tresor öffnen und lesen
• Dokumente jetzt als platzsparende Liste
• Tippe auf die Glocke, um zu sehen, was ansteht
• Bleib dran: tägliche Serie, Abendessen-Erinnerung und Sonntags-Rückblick
• Hinweis, wenn dein Co-Elternteil eine Notiz oder Ankündigung hinterlässt
• Rundum flüssiger, klarer und feiner
</de-DE>
```
