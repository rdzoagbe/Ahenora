# Data-flow map

_Prepared for the 2026 grant dossier (strategy of 20 September 2026, Priority B). Written from the code as of 20 September 2026 and regenerated with it: every statement below names the routine that enforces it. Items marked **[CONFIRM]** are facts the repository cannot prove and the founder must check in the provider's console before filing._

## 1. Who Ahenora processes data about

| Person | How they appear | Account? |
| --- | --- | --- |
| Parent / co-parent | Signs up with email and password, Google or Apple | Yes |
| Helper (grandparent, carer) | Invited by a parent; same app, sensitive surfaces refused server-side (`require_full_member`) | Yes |
| Teen (13–17) | Invited by a parent; own login, own restricted view (`_teen_can_see`) | Yes |
| Child (under 13) | A profile a parent creates and controls; no login, no email. Enters kid mode on the parent's phone with a PIN (`/api/kid/session`) | No |

## 2. Data categories, purpose, lawful basis, retention

| Category | Examples | Purpose | Lawful basis (GDPR) | Where | Retention |
| --- | --- | --- | --- | --- | --- |
| Account | email, name, language, picture URL, password hash (PBKDF2-SHA256, 200,000 iterations), Google/Apple subject id | Sign-in, household membership | Contract (Art. 6(1)(b)) | `users` | Until account deletion (`/api/auth/delete-account`), immediate |
| Sessions | SHA-256 hash of the session token, expiry, device platform | Keep the person signed in | Contract | `user_sessions` | 90 days sliding (`SESSION_DAYS`); ended on sign-out, password change, deletion |
| Household | family name, custody pattern, plan, member rows (name, role, avatar, age, stars) | The product itself | Contract | `families`, `family_members` | Until the last account in the household is deleted (`_purge_family`) |
| Child profile | name, optional age, PIN hash, stars, rewards, notes from a parent | Chores and rewards for a child under 13 | Contract with the parent, who consents on the child's behalf | `family_members`, `rewards`, `redemptions`, `star_transactions` | With the household |
| Child health record | vaccinations, medicines, allergies, conditions, blood group, as a parent types them | A parent's own record of their child | Explicit consent of the parent (Art. 9(2)(a)); **special-category data**, see DPIA note | `family_members.record` | With the household; editable and deletable by a parent at any time |
| Cards | tasks, events, appointments, sign slips, RSVPs; title, notes, date, assignee, location, icon; optionally the scanned image | Household coordination | Contract | `cards` | Until deleted by a member or with the household |
| Vault documents | image or file, title, category, expiry, who may see it | Keeping family papers | Contract | `vault` | Until deleted by the owner or with the household |
| Messages | household, kid and teen threads | Family communication | Contract | `messages` | With the household |
| Kitchen | meals, recipes, shopping list and history | Meal planning | Contract | `meals`, `shopping_list`, `shopping_history`, `meal_plans_saved` | With the household |
| Money | pocket money, expenses, gift pots, Secret Santa draws | Family money coordination | Contract | `allowances`, `allowance_txns`, `expenses`, `expense_items`, `gift_pots`, `santa_draws` | With the household |
| Calendar import | events pulled from Google Calendar when the person starts a sync | Import on request | Contract, at the person's request | `event_candidates` (30 days, `CANDIDATE_TTL_DAYS`), then `cards` | Candidates auto-deleted after 30 days |
| Push tokens | Expo push token, Web Push subscription endpoint | Notifications the person turned on | Contract; each category can be switched off (`notification_settings`) | `notification_tokens`, `web_push_subscriptions` | Deleted with the account |
| Billing | RevenueCat customer id, plan, webhook events; Stripe customer id for web checkout | Subscriptions | Contract; legal obligation for records | `families`, `billing_events` | Billing events kept as legally required |
| Activity log | "Roland added a card", household-visible lines | The household feed | Contract | `activity` | With the household |
| Support tickets | message and the sender's email | Support | Contract | `support_tickets` | Until resolved and purged with the account |
| Product metrics | daily counters (signups, cards created), timings; **no content** | Running the service | Legitimate interest (Art. 6(1)(f)) | `metrics_daily` | Aggregate, no personal data |
| Error reports | endpoint, status, message, platform, build; grouped server-side | Reliability | Legitimate interest | `client_errors`, unhandled-error groups | 14 days (bounded retention in `report_client_error`) |

Data minimisation choices worth stating in the dossier: children have no account, no email and no login; the PIN and every password are stored only as hashes; scans are cropped to the page on the server before the AI provider sees them (`crop_to_document`); a private card or document is private in the database, not only in the interface (`_card_visible_to`, `_may_see_vault_doc`); product metrics count events and never store content.

## 3. Processors and sub-processors

| Provider | What they receive | Why | Location | Contract |
| --- | --- | --- | --- | --- |
| Railway (hosting) | The whole backend, in memory and logs | Running the API | **[CONFIRM region]** | DPA **[CONFIRM signed]** |
| MongoDB Atlas (database, M10 dedicated) | Every table above, encrypted at rest, TLS in transit (`mongodb+srv`) | Storage; continuous backups | **[CONFIRM region]** | DPA **[CONFIRM signed]** |
| Google (Gemini API) | Only the content of an AI request at the moment the person makes it: a scanned image, a voice recording, recipe or meal text, a task to assign. See `AI_PROCESSING_MAP.md` | AI-assisted features | Google Cloud, region per API | Google API terms; paid-usage data not used for training **[CONFIRM current terms]** |
| Google Sign-In, Apple Sign-In | The identity token the person's device presents; verified server-side (`google_id_token`, `apple_auth`) | Sign-in | Google / Apple | Platform terms |
| Expo push service | Push token and notification title/body | Phone notifications | Expo (US) **[CONFIRM]** | Expo terms |
| Web Push (browser vendors) | Subscription endpoint and the notification payload, signed with our VAPID key | Browser notifications | Browser vendor's push service | Standard |
| Resend | Recipient address and the transactional email body (invites, password reset, deletion receipt) | Email | **[CONFIRM region]** | DPA **[CONFIRM]** |
| RevenueCat | App-store purchase receipts and a customer id | Subscriptions on Play and App Store | US **[CONFIRM]** | DPA **[CONFIRM]** |
| Stripe | Card checkout on the web; card details never touch Ahenora | Web subscriptions | EU entity available **[CONFIRM]** | Stripe DPA |
| Google Play, Apple App Store | Store accounts; not processors of household data | Distribution | — | — |
| GitHub Pages | The static website and web app export; no personal data stored | ahenora.com | — | — |

No advertising network, no analytics vendor and no session-replay tool is integrated. Product metrics are computed inside our own database.

## 4. Flows a reviewer will ask about

- **A scanned school letter.** Photo taken on the phone (native scanner crops to the page) → sent over TLS to the backend → cropped again server-side → sent to Gemini with a fixed system prompt → the structured answer is validated (`validate_document_scan`: type, title, date, category, refusing anything else) → becomes a card and, if the person chooses, a vault document with the image. The image is stored in our database, not at the AI provider.
- **A co-parent invitation.** Email address entered by a parent → invitation row with a random token (60 days) → email via Resend → acceptance links the invitee's account to the household. Unaccepted invitations expire.
- **A child in kid mode.** The parent's phone, a PIN → a separate kid session token limited to five routes (home, notes, finish a chore, request a reward, exit). No access to the vault, cards of others, members, chat threads of adults or settings; tested end to end (`scripts/e2e_kid.py`).
- **Deletion.** Self-service in the app. Last account in a household → the household and everything in it is purged; otherwise only that person leaves. A receipt email follows. Backups age out on the provider's schedule.
- **A copy of my data.** Self-service in the app ("Download my data", `/api/auth/export`): everything the person can see, as one JSON file, nothing secret.

## 5. DPIA note

A screening is warranted, and a full DPIA is likely required, because three factors combine: data about children, health data a parent records about a child, and profiling-adjacent automation (AI reading documents). The mitigations already in place are listed in `SECURITY_BASELINE.md` and `CHILD_TEEN_PERMISSIONS.md`. Obtain qualified advice; this document is an engineering inventory, not a legal opinion.
