# Household COO — Product Roadmap & Decisions

The single source of truth for what's decided, what's parked, and what comes next.
Last updated: July 2026.

---

## Where we are

- **Closed testing live** on Google Play (personal dev account → requires **12+ testers opted in for 14 continuous days** before production access can be requested).
- App is feature-complete for launch: onboarding, full **EN/FR/ES/DE** localization (715 keys/locale), morning digest, usage metrics, robustness-hardened UI.
- **Delivery pipeline:** push to `main` → auto **OTA update** to testers (JS changes, seconds). Native changes → `EAS Build (Android)` workflow (manual trigger) → AAB → Play Console upload. Auto-submit to Play activates once the `GOOGLE_SERVICE_ACCOUNT_KEY` secret is added.

## Launch checklist (current sprint)

- [ ] 12+ testers opted in via https://play.google.com/apps/testing/com.householdcoo.app (Gmail added in Play Console **first**)
- [ ] Countries enabled on the closed track (France added for diaspora testers; simplest: all countries)
- [ ] 14 continuous days at 12+ testers
- [ ] Apply for production access (answer recruitment/feedback questions honestly — real testers, real bug reports)
- [ ] **Email deliverability — add DMARC record** to the sending domain `joblytics-ai.com` (Squarespace DNS): TXT record, host `_dmarc`, value `v=DMARC1; p=none; rua=mailto:<you>@joblytics-ai.com`. Resend already sets SPF+DKIM; DMARC lifts inbox placement. Also click "Not spam" on the first tester invites to warm up sender reputation.
- [ ] Final production AAB → production track → Google review → **public launch** 🚀

> **Email sending — status & notes.** Invites send via Resend from a from-address on the **verified** domain `joblytics-ai.com` (`INVITE_FROM_EMAIL`). Two bugs fixed during closed testing: a stray trailing space in the `GOOGLE_API_KEY` Railway variable name (unrelated, broke AI features), and a missing `User-Agent` header on the Resend request (caused `403 error 1010`, blocked all sends). Email template is now light/transactional with `List-Unsubscribe` headers. Remaining: DMARC (above) + reputation warm-up. Public-launch polish: move sending to a **matching** domain (e.g. `householdcoo.app`) so the sender brand matches the app.

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

### Step 0 — Launch stabilization (first ~1–2 weeks)
Before building anything new, watch the wider audience.
- **Staged production rollout** (~20% → 50% → 100% over a few days), not 100% at once.
- Watch **Play Console** crash-free rate + ANRs, reviews, and **Settings → Usage analytics**.
- Fix whatever real users surface via OTA.
- Feature freeze lifts → batch the held **Dependabot** updates one small, verified PR at a time.

### Phase 1 — Monetization (Google Play Billing)  *— highest ROI, do first*
Already scaffolded: pricing decided, `PLAN_CATALOG` exists, "coming soon" upgrade alerts in place.
1. Create the two subscriptions in Play Console — **Executive** and **Family Office**, each monthly + yearly ($8.99/$69.99, $19.99/$179.99).
2. Add **RevenueCat** (handles receipt validation, entitlements, renewals — needs a build). Alt: `react-native-iap`.
3. **Backend:** entitlement webhook sets the family's plan; **restore real member limits** in `PLAN_CATALOG` (Village was relaxed to 10 for testing) and enforce **parents uncounted, kids metered 1/4/10**.
4. **Frontend:** replace `promptUpgrade` alerts with the real purchase sheet; unlock gated features off the entitlement.
- Native build required. **Phase 4 AI features monetize through this — Billing lands first.**

### Phase 2 — Web version (iPhone family access)
- `expo export --platform web` → free static hosting (Vercel/Netlify/GitHub Pages).
- Work is **guarding native-only modules** for web (document-picker, sharing, intent-launcher, PDF/WebView) with web fallbacks.
- Add the **web origin** to Google OAuth allowed origins + backend `ALLOWED_ORIGINS` (CORS).
- Positioning: companion access for iPhone family members — not a full iOS app (that's the $99/yr Apple program, later, when revenue justifies).

### Phase 3 — Platform polish (ranking + engagement)
- **Android home-screen widget** (today's tasks) — native build. `react-native-android-widget` or a small native module + config plugin.
- **Tablet / landscape** — unlock the portrait lock in `app.json`; lean on existing `useBreakpoint` responsive layouts; polish large screens (Play ranking factor). Native build for the orientation change.
- **Crash-report mapping** — upload deobfuscation `mapping.txt` (or add Sentry) so production crashes are readable.

### Phase 4 — AI food & gifting (Executive-tier differentiators)
- **Cooking steps per meal (recipes):** each suggested meal gets a short, parent-friendly recipe — step-by-step instructions + timings — so choosing a dinner also tells you *how to cook it*. Build path: ① add a `steps` field to the `mealSuggestions.ts` library (localized like titles, OTA-friendly, works offline) for the 38 curated meals, shown in a "Cook it" view from the planner/suggestion sheet; ② later, Gemini generates steps for *any* custom meal a parent typed themselves (needs API budget → Premium AI Chef umbrella). Dinner-reminder tie-in: the 17:30 nudge can deep-link straight to tonight's recipe.
- **AI Chef (fridge scan):** photograph groceries → reuse the **Gemini vision pipeline** (same as document scan), new prompt → one-tap add missing items to the shopping list. Lives in the **Kitchen tab**. Mostly a new prompt + UI (OTA-friendly).
- **AI Gift Concierge:** ① birthday field on members → "birthday in 3 days" **feed card** (also retention idea #5), ② Gemini gift suggestions with budget, ③ birthday message + notification, ④ retailer **affiliate link-outs** for revenue (no gift-card *issuance* — payments regulation).

### Parked (only if users ask)
- **Kid logins** (children checking off their own chores) — flips Play audience to mixed → Families-program compliance. Revisit only on demand.
- **Tech debt at real scale (~1k users):** vault files base64-in-Mongo → object storage; split the 3,700-line `server.py`; Mongo indexes on `family_id`; PBKDF2 iteration bump.

### How we execute
- Same rhythm as the build-out: small branch → `tsc`/`jest`/`py_compile` → PR → merge → **OTA** for JS, **EAS build** for anything native.
- **New for production:** staged rollouts; watch crash-free rate; always flag build-vs-OTA before shipping.
- **Recommended sequence:** Stabilize → **Billing** → **Web** → **Polish** → **AI**.

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
