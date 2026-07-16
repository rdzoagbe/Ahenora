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

## Pricing (decided)

Kid-metered tiers, **both parents always free**:

| Tier | Price | Household |
|------|-------|-----------|
| Village (free) | $0 | 2 parents + 1 child |
| Executive | $8.99/mo · $69.99/yr | 2 parents + up to 4 children |
| Family Office | $19.99/mo · $179.99/yr | Extended household: up to 10 children + caregivers |

Display-only today. **Testing window:** the Village member cap is temporarily
relaxed to 10 so closed-test families can explore multi-kid features (no way to
upgrade exists yet). **Enforcement** (parents uncounted, children metered 1/4/10, extra adults gated to Family Office) ships together with billing. Google Play Billing handles currency localization, tax, and payouts (15% fee) — **no Stripe** for in-app subscriptions (Play policy).

---

## Post-launch phases (in order)

### Phase 1 — Google Play Billing
- Integrate Play Billing library; define the two subscription products in Play Console
- Role-aware member limits (backend `PLAN_CATALOG` + enforcement)
- Real upgrade flow replaces the "coming soon" alerts
- Automated release notes via `eas submit` what's-new files

### Phase 2 — Web version (iPhone access)
- `expo export` for web; fix native-module edges; free static hosting
- Google OAuth: add web origin to allowed origins (owner action)
- Positioning: companion access for iPhone family members (owner's co-parent is on iPhone). Not a substitute for the future native iOS app ($99/yr Apple program, when revenue justifies)

### Phase 3 — Engagement & platform polish
- **Android home-screen widget** (today's tasks) — native change
- **Tablet landscape** (unlock portrait-only orientation; native change) + large-screen polish (Play ranking factor)
- Deobfuscation mapping upload for native crash reports (nice-to-have)

### Phase 4 — AI food & gifting (Executive-tier candidates)

**AI Chef (fridge scan):** photograph the fridge/groceries → existing Gemini
vision pipeline proposes meals that can be cooked from what's there; one tap
adds missing ingredients to the shopping list. Same machinery as the document
scan — new prompt, new UI.

**AI Gift Concierge:**
1. Birthday field on family members → "birthday coming up" feed card
2. AI gift suggestions with budget (existing Gemini integration)
3. Birthday message + family notification
4. Retailer **link-outs with affiliate links** (revenue; no gift-card issuance — that would mean payments regulation + Play financial-features redeclaration)

### Parked (deliberately)
- **Kid sessions** (children checking off their own chores from their phones): great retention idea, but adding child *users* flips the Play target-audience declaration to mixed-audience → Google Families program compliance. Revisit **only if testers/users ask for it** post-launch.
- **Dependabot PRs** (fastapi, pymongo, babel 8, etc.): major bumps held during testing; batch carefully after launch.
- **Tech debt** (revisit at real scale): vault images as base64 in Mongo → object storage (~1k users); split the 3,700-line `server.py`; Mongo indexes on `family_id`; PBKDF2 iterations bump.

---

## Operating rules (learned the hard way)

- **Nothing breaks during a live test.** Feature freezes are real; OTA only ships fixes/polish.
- JS fixes ship via OTA on merge to `main`; testers need **two full app relaunches** to receive them.
- The backend URL is guarded at runtime against the retired `-backend-` Railway subdomain; the canonical URL is `https://household-coo-production.up.railway.app` (keep GitHub secrets + EAS env in sync).
- Localized copy must fit: FR/DE run ~25% longer than EN — tight UI uses short translations + `adjustsFontSizeToFit`.
- Testers only count when they're added by Gmail in Play Console **and** tap "Become a tester". Quality of engagement matters to Google — never buy testers.
- Usage metrics are first-party, count-only (`/api/metrics/summary`, admin-only). Check DAU + feature counts mid-test to guide decisions.

---

## Release notes — build "1.0.0 – Rewards, invites & polish"

Paste the matching language block into Play Console → closed testing → release notes.
Each is under Play's 500-character limit. Update this section for each new build.

**Release name:** `1.0.0 – Rewards, invites & polish`

**English (en-US)**
```
What's new:
• 🎉 Star celebrations when kids earn rewards
• Fix a child's star balance if points were added by mistake
• Set pocket money per child, with an age-based guide
• 3 ways to invite family: email, text, or a share link
• Attach PDF files to the Vault, not just photos
• Share Vault documents by email or messaging apps
• Numbered shopping list you can check off
• Dark mode is now clearly readable everywhere
• Faster, more reliable — several fixes under the hood
```

**Français (fr-FR)**
```
Nouveautés :
• 🎉 Célébrations quand les enfants gagnent des étoiles
• Corrigez le solde d'étoiles en cas d'erreur
• Argent de poche par enfant, avec un repère selon l'âge
• 3 façons d'inviter : e-mail, SMS ou lien à partager
• Ajoutez des fichiers PDF au coffre, pas que des photos
• Partagez les documents du coffre par e-mail ou messagerie
• Liste de courses numérotée à cocher
• Mode sombre bien lisible partout
• Plus rapide et fiable — corrections internes
```

**Español (es-ES)**
```
Novedades:
• 🎉 Celebraciones cuando los niños ganan estrellas
• Corrige el saldo de estrellas si hubo un error
• Fija la paga por niño, con una guía según la edad
• 3 formas de invitar: correo, SMS o enlace
• Adjunta archivos PDF al baúl, no solo fotos
• Comparte documentos del baúl por correo o mensajería
• Lista de compras numerada para marcar
• Modo oscuro legible en todas partes
• Más rápido y fiable — varias correcciones
```

**Deutsch (de-DE)**
```
Neu:
• 🎉 Feier-Momente, wenn Kinder Sterne verdienen
• Sterne-Stand bei Fehlern korrigieren
• Taschengeld pro Kind, mit Alters-Richtwert
• 3 Wege zum Einladen: E-Mail, SMS oder Link
• PDF-Dateien im Tresor speichern, nicht nur Fotos
• Tresor-Dokumente per E-Mail oder Messenger teilen
• Nummerierte Einkaufsliste zum Abhaken
• Dunkler Modus überall gut lesbar
• Schneller und stabiler — diverse Fixes
```
